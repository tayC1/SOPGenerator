/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable('saved_sops', {
    user_id: {
      type: 'integer',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    sop_id: {
      type: 'integer',
      notNull: true,
      references: 'sops',
      onDelete: 'CASCADE',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  }, {
    constraints: {
      primaryKey: ['user_id', 'sop_id'],
    },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable('saved_sops');
};
