/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.addColumn('sops', {
    doc_type: {
      type: 'text',
      notNull: true,
      default: 'sop',
    },
    content: {
      type: 'text',
    },
  });

  pgm.addConstraint('sops', 'sops_doc_type_check', {
    check: "doc_type IN ('sop', 'document')",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropConstraint('sops', 'sops_doc_type_check');
  pgm.dropColumn('sops', ['doc_type', 'content']);
};
