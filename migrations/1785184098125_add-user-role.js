/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn('users', {
    role: {
      type: 'text',
      notNull: true,
      default: 'member',
    },
  });

  pgm.addConstraint('users', 'users_role_check', {
    check: "role IN ('member', 'department_admin', 'super_admin')",
  });

  // Preserve current access exactly: every existing is_admin=true user was
  // an unscoped/global admin, so they all become super_admin. Anyone who
  // should instead be scoped to specific departments gets re-tiered to
  // department_admin afterward via the admin portal's "Is Admin" toggle.
  pgm.sql("UPDATE users SET role = 'super_admin' WHERE is_admin = true");

  pgm.dropColumn('users', 'is_admin');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.addColumn('users', {
    is_admin: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
  });
  pgm.sql("UPDATE users SET is_admin = true WHERE role IN ('super_admin', 'department_admin')");

  pgm.dropConstraint('users', 'users_role_check');
  pgm.dropColumn('users', 'role');
};
