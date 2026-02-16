const { t } = require("./i18n");

function deleteAction(installation) {
  return {
    id: "delete", label: t("actions.delete"), style: "danger", enabled: true,
    showProgress: true, progressTitle: "Deleting…",
    confirm: {
      title: t("actions.deleteConfirmTitle"),
      message: t("actions.deleteConfirmMessage") + `\n${installation.installPath}`
    }
  };
}

function untrackAction() {
  return {
    id: "remove", label: t("actions.untrack"), style: "danger", enabled: true,
    confirm: {
      title: t("actions.untrackConfirmTitle"),
      message: t("actions.untrackConfirmMessage")
    }
  };
}

module.exports = { deleteAction, untrackAction };
