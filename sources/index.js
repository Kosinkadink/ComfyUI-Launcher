const portable = require("./portable");
const standalone = require("./standalone");
const git = require("./git");
const remote = require("./remote");

const sources = [portable, standalone, git, remote];

module.exports = sources;
