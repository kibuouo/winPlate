const notificationSchema = require("./schemas/notification.v1.schema.json");
const statusModuleSchema = require("./schemas/status-module.v1.schema.json");
const usageSchema = require("./schemas/usage.v1.schema.json");
const notificationTaxonomy = require("./notification-taxonomy.v1.json");

module.exports = {
  notificationSchema,
  notificationTaxonomy,
  statusModuleSchema,
  usageSchema,
  schemas: {
    notification: notificationSchema,
    notificationTaxonomy,
    statusModule: statusModuleSchema,
    usage: usageSchema
  }
};
