#!/usr/bin/env node
// Admin CLI for managing CODEX users directly against the Postgres database
// - the terminal equivalent of the /admin/users page, for people setup
// before someone signs in, or when the web app itself isn't reachable.
// Talks straight to the DB via ../db.js, bypassing HTTP/session auth
// entirely, so there's no role-scoping here the way server.js has for
// department_admins - whoever runs this CLI has full access.
//
// Lives in its own package (cli/) so installing it - via `brew install`,
// `npm install -g`, or local `npm link` - doesn't drag in the full web
// server's dependencies (express, passport, googleapis, mupdf, etc). See
// cli/README.md for install methods.
//
// Usage:
//   codex add-user
//   codex list-users [--department <name>] [--role <role>]
//   codex set-role <email> <member|department_admin|super_admin>
//   codex deactivate <email>
//   codex reactivate <email>
//   codex add-category
//   codex delete-category <name>

const { Command } = require('commander');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');
const db = require('../lib/db');
const pkg = require('../package.json');

const WORKSPACE_DOMAIN = process.env.WORKSPACE_DOMAIN || 'kramer.pro';
const ROLES = ['member', 'department_admin', 'super_admin'];

async function withUser(email, fn) {
  const result = await db.query('SELECT id, name, email, role, is_active FROM users WHERE email = $1', [email.toLowerCase()]);
  if (result.rows.length === 0) {
    console.error(`No user found with email ${email}`);
    process.exitCode = 1;
    return;
  }
  await fn(result.rows[0]);
}

async function promptRequired(rl, question) {
  let answer;
  do {
    answer = (await rl.question(question)).trim();
    if (!answer) console.log('This field is required.');
  } while (!answer);
  return answer;
}

async function addUser() {
  const rl = readline.createInterface({ input, output });
  try {
    const departments = (await db.query('SELECT name FROM departments ORDER BY name')).rows.map((r) => r.name);

    const name = await promptRequired(rl, 'Full name: ');

    let email;
    for (;;) {
      email = (await promptRequired(rl, 'Email: ')).toLowerCase();
      if (email.endsWith(`@${WORKSPACE_DOMAIN}`)) break;
      console.log(`Email must be an @${WORKSPACE_DOMAIN} address.`);
    }

    console.log('\nDepartments:');
    departments.forEach((d, i) => console.log(`  ${i + 1}. ${d}`));

    let department;
    for (;;) {
      const answer = await promptRequired(rl, 'Department (number or name): ');
      department =
        departments.find((d) => d.toLowerCase() === answer.toLowerCase()) ||
        departments[parseInt(answer, 10) - 1];
      if (department) break;
      console.log(`"${answer}" is not a recognized department.`);
    }

    const [firstName, ...rest] = name.split(' ');
    const lastName = rest.join(' ') || null;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO users (email, name, first_name, last_name, display_name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name,
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           display_name = EXCLUDED.display_name
         RETURNING id`,
        [email, name, firstName, lastName, name]
      );
      const userId = result.rows[0].id;
      await client.query(
        `INSERT INTO user_departments (user_id, department_name) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [userId, department]
      );
      await client.query('COMMIT');
      console.log(`\nAdded ${name} <${email}> to ${department}.`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    rl.close();
  }
}

async function addCategory() {
  const rl = readline.createInterface({ input, output });
  try {
    let name;
    for (;;) {
      name = await promptRequired(rl, 'Category name: ');
      const exists = await db.query('SELECT 1 FROM departments WHERE lower(name) = lower($1)', [name]);
      if (exists.rows.length === 0) break;
      console.log(`"${name}" already exists.`);
    }

    const lead = (await rl.question('Lead (optional, press enter to skip): ')).trim() || null;
    const description = (await rl.question('Description (optional, press enter to skip): ')).trim() || null;

    const result = await db.query(
      `INSERT INTO departments (name, lead, description) VALUES ($1, $2, $3) RETURNING name`,
      [name, lead, description]
    );
    console.log(`\nAdded category "${result.rows[0].name}".`);
  } finally {
    rl.close();
  }
}

async function deleteCategory(name) {
  const dept = await db.query('SELECT id, name FROM departments WHERE lower(name) = lower($1)', [name]);
  if (dept.rows.length === 0) {
    console.error(`No category found named "${name}".`);
    process.exitCode = 1;
    return;
  }
  const { id, name: actualName } = dept.rows[0];

  // department_name/category are plain text, not FKs, so deleting the row
  // wouldn't fail loudly - it'd just silently orphan any SOPs/members still
  // tagged with this name. Block instead, so those get reassigned first.
  const [sopCount, memberCount] = await Promise.all([
    db.query('SELECT COUNT(*)::int AS count FROM sops WHERE category = $1', [actualName]),
    db.query('SELECT COUNT(*)::int AS count FROM user_departments WHERE department_name = $1', [actualName]),
  ]);
  const sops = sopCount.rows[0].count;
  const members = memberCount.rows[0].count;
  if (sops > 0 || members > 0) {
    console.error(
      `Cannot delete "${actualName}": still used by ${sops} SOP${sops === 1 ? '' : 's'} and ${members} member${members === 1 ? '' : 's'}. Reassign them first.`
    );
    process.exitCode = 1;
    return;
  }

  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(`Delete category "${actualName}"? This cannot be undone. (y/N) `);
  rl.close();
  if (answer.trim().toLowerCase() !== 'y') {
    console.log('Cancelled.');
    return;
  }

  await db.query('DELETE FROM departments WHERE id = $1', [id]);
  console.log(`Deleted category "${actualName}".`);
}

async function listUsers({ department, role }) {
  const result = await db.query(
    `SELECT u.id, u.name, u.email, u.role, u.is_active,
            COALESCE(array_agg(ud.department_name) FILTER (WHERE ud.department_name IS NOT NULL), '{}') AS departments
     FROM users u
     LEFT JOIN user_departments ud ON ud.user_id = u.id
     WHERE ($1::text IS NULL OR EXISTS (
             SELECT 1 FROM user_departments d2 WHERE d2.user_id = u.id AND d2.department_name = $1
           ))
       AND ($2::text IS NULL OR u.role = $2)
     GROUP BY u.id
     ORDER BY u.name`,
    [department || null, role || null]
  );

  if (result.rows.length === 0) {
    console.log('No matching users.');
    return;
  }

  console.table(
    result.rows.map((u) => ({
      id: u.id,
      name: u.name || '(unclaimed)',
      email: u.email,
      role: u.role,
      active: u.is_active,
      departments: u.departments.join(', '),
    }))
  );
}

async function setRole(email, role) {
  if (!ROLES.includes(role)) {
    console.error(`Role must be one of: ${ROLES.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  await withUser(email, async (user) => {
    const result = await db.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING name, email, role',
      [role, user.id]
    );
    console.log(`${result.rows[0].email} is now ${result.rows[0].role}.`);
  });
}

async function deactivate(email) {
  await withUser(email, async (user) => {
    if (!user.is_active) {
      console.log(`${user.email} is already inactive.`);
      return;
    }
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question(`Deactivate ${user.name || user.email} <${user.email}>? (y/N) `);
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('Cancelled.');
      return;
    }
    await db.query(
      `UPDATE users SET is_active = false, deactivated_at = NOW(), extension_token = NULL WHERE id = $1`,
      [user.id]
    );
    console.log(`Deactivated ${user.email}.`);
  });
}

async function reactivate(email) {
  await withUser(email, async (user) => {
    if (user.is_active) {
      console.log(`${user.email} is already active.`);
      return;
    }
    await db.query(`UPDATE users SET is_active = true, deactivated_at = NULL WHERE id = $1`, [user.id]);
    console.log(`Reactivated ${user.email}.`);
  });
}

async function main() {
  const program = new Command();
  program.name('codex').description('CODEX admin CLI').version(pkg.version);

  program.command('add-user')
    .description('interactively add a new employee')
    .action(addUser);

  program.command('list-users')
    .description('list employees')
    .option('-d, --department <name>', 'filter by department')
    .option('-r, --role <role>', `filter by role (${ROLES.join('|')})`)
    .action(listUsers);

  program.command('set-role <email> <role>')
    .description(`change a user's role (${ROLES.join('|')})`)
    .action(setRole);

  program.command('deactivate <email>')
    .description('deactivate a user (soft delete)')
    .action(deactivate);

  program.command('reactivate <email>')
    .description('reactivate a previously deactivated user')
    .action(reactivate);

  program.command('add-category')
    .description('interactively add a new category (department)')
    .action(addCategory);

  program.command('delete-category <name>')
    .description('delete a category (department), if not currently in use')
    .action(deleteCategory);

  await program.parseAsync(process.argv);
}

main()
  .catch((err) => {
    console.error('codex: error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
