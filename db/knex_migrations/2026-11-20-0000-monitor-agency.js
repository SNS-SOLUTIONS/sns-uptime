exports.up = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        // An agency is a group sitting at the top of the tree, gathering the
        // folders and monitors of one site: MARSEILLE → folder → monitor.
        // It is always stored as a folder only group at the root, the server
        // enforces it on every save.
        table.boolean("agency").notNullable().defaultTo(false);
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.dropColumn("agency");
    });
};
