import { showToast, Toast, Action, Icon, Color, confirmAlert, Alert, showHUD } from "@raycast/api";
import { getVSCodiumCLI } from "./lib/vscodium";
import { getErrorMessage } from "./utils";

export function InstallExtensionByIDAction(props: { extensionID: string; afterInstall?: () => void }): JSX.Element {
  const handle = async () => {
    try {
      await showToast({
        style: Toast.Style.Animated,
        title: "Install Extension",
      });
      const cli = getVSCodiumCLI();
      cli.installExtensionByIDSync(props.extensionID);
      await showToast({
        style: Toast.Style.Success,
        title: "Install Successful",
      });
      if (props.afterInstall) {
        props.afterInstall();
      }
    } catch (error) {
      showToast({
        style: Toast.Style.Failure,
        title: "Error",
        message: getErrorMessage(error),
      });
    }
  };
  return <Action onAction={handle} title="Install Extension" icon={{ source: Icon.Plus }} />;
}

export function UninstallExtensionByIDAction(props: { extensionID: string; afterUninstall?: () => void }): JSX.Element {
  const handle = async () => {
    try {
      if (
        await confirmAlert({
          title: "Uninstall Extension?",
          icon: { source: Icon.Trash, tintColor: Color.Red },
          primaryAction: {
            style: Alert.ActionStyle.Destructive,
            title: "Uninstall",
          },
        })
      ) {
        await showToast({
          style: Toast.Style.Animated,
          title: "Uninstall Extension",
        });
        const cli = getVSCodiumCLI();
        cli.uninstallExtensionByIDSync(props.extensionID);
        await showToast({
          style: Toast.Style.Success,
          title: "Uninstall Successful",
        });
        if (props.afterUninstall) {
          props.afterUninstall();
        }
      }
    } catch (error) {
      showToast({
        style: Toast.Style.Failure,
        title: "Error",
        message: getErrorMessage(error),
      });
    }
  };
  return <Action onAction={handle} title="Uninstall Extension" icon={{ source: Icon.Trash, tintColor: Color.Red }} />;
}

export function OpenExtensionByIDInVSCodiumAction(props: {
  extensionID: string;
  onOpen?: (url: string) => void;
}): JSX.Element {
  return (
    <Action.OpenInBrowser
      title="Open in VSCodium"
      url={`vscodium:extension/${props.extensionID}`}
      icon={"icon.png"}
      onOpen={(url) => {
        showHUD("Open VSCodium Extension");
        if (props.onOpen) {
          props.onOpen(url);
        }
      }}
    />
  );
}

export function OpenExtensionByIDInBrowserAction(props: { extensionID: string }): JSX.Element {
  const url = `https://open-vsx.org/extension/${props.extensionID.replace(".", "/")}`;
  return (
    <Action.OpenInBrowser
      title="Open in Open VSX"
      url={url}
      shortcut={{ modifiers: ["cmd"], key: "b" }}
      onOpen={() => {
        showHUD("Open Open VSX Extension");
      }}
    />
  );
}
