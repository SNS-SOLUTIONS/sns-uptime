exports.up = function (knex) {
    return knex.schema.alterTable("user", function (table) {
        table.string("email", 255).defaultTo(null);
        table.string("display_name", 255).defaultTo(null);
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable("user", function (table) {
        table.dropColumn("email");
        table.dropColumn("display_name");
    });
};
