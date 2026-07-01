const notificationSchema = require("./schemas/notification.v1.schema.json");
const statusModuleSchema = require("./schemas/status-module.v1.schema.json");
const usageSchema = require("./schemas/usage.v1.schema.json");

module.exports = {
  notificationSchema,
  statusModuleSchema,
  usageSchema,
  schemas: {
    notification: notificationSchema,
    statusModule: statusModuleSchema,
    usage: usageSchema
  }
};
