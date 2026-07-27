/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn('users', {
    is_active: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    deactivated_at: {
      type: 'timestamptz',
    },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropColumn('users', ['is_active', 'deactivated_at']);
};
