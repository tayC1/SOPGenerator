/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn('sops', {
    updated_by: {
      type: 'integer',
      references: 'users',
      onDelete: 'SET NULL',
    },
    // Denormalized alongside updated_by (same convention as the existing
    // `author` column) so list views can show "last edited by X" without a
    // join, and the name survives if the editor's account is later deleted.
    updated_by_name: {
      type: 'text',
    },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropColumn('sops', ['updated_by', 'updated_by_name']);
};
