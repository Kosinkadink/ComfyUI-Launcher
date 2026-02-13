const portable = require("./portable");
const standalone = require("./standalone");
const git = require("./git");
const remote = require("./remote");
const cloud = require("./cloud");

const sources = [portable, standalone, git, cloud, remote];

module.exports = sources;
