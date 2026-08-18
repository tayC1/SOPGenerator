/**
 * Snapshot written on every create/edit of a sop (see routes/sops.js) - one
 * row per saved state, each tagged with who saved it and when. This is an
 * append-only audit trail, not a diff: each row is a full copy of the
 * fields that can actually change, so viewing history never needs to replay
 * anything.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable('sop_revisions', {
    id: 'id',
    sop_id: {
      type: 'integer',
      notNull: true,
      references: 'sops',
      onDelete: 'CASCADE',
    },
    edited_by: {
      type: 'integer',
      references: 'users',
      onDelete: 'SET NULL',
    },
    edited_by_name: {
      type: 'text',
    },
    edited_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    title: { type: 'text' },
    description: { type: 'text' },
    steps: { type: 'jsonb' },
    content: { type: 'text' },
    category: { type: 'text' },
    tag: { type: 'text' },
    doc_type: { type: 'text' },
  });

  pgm.createIndex('sop_revisions', 'sop_id');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable('sop_revisions');
};
