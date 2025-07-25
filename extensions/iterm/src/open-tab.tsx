import { runAppleScript } from "run-applescript";
import { closeMainWindow, popToRoot, showToast, Toast, List, ActionPanel, Action, LocalStorage, getPreferenceValues, Icon, Color } from "@raycast/api";
import { isPermissionError, PermissionErrorScreen } from "./core/permission-error-screen";
import { useEffect, useState, useCallback } from "react";

interface ItermTab {
  windowId: string;
  tabId: string;
  sessionId: string;
  name: string;
  windowName: string;
  isFavorite?: boolean;
}

interface Preferences {
  defaultWindowName?: string;
  showOnlyNamedTabs?: boolean;
}

const FAVORITES_STORAGE_KEY = "iterm-tab-favorites";

// Updated AppleScript to enumerate all tabs across all windows
const scriptToListTabs = `
  tell application "iTerm"
    set output to "["
    set needsComma to false
    
    set windowCount to count of windows
    repeat with wIndex from 1 to windowCount
      set w to window wIndex
      set wId to wIndex as string
      set wName to name of w
      
      set tabCount to count of tabs of w
      repeat with tIndex from 1 to tabCount
        set t to tab tIndex of w
        
        -- Get current session info
        set s to current session of t
        set sName to name of s
        
        -- Escape special characters for JSON
        set wNameEscaped to my escapeForJson(wName)
        set sNameEscaped to my escapeForJson(sName)
        
        -- Build JSON object using indices as IDs
        set tabJson to "{\\"windowId\\":\\"" & wId & "\\",\\"tabId\\":\\"" & tIndex & "\\",\\"sessionId\\":\\"" & wIndex & "-" & tIndex & "\\",\\"name\\":\\"" & sNameEscaped & "\\",\\"windowName\\":\\"" & wNameEscaped & "\\"}"
        
        if needsComma then
          set output to output & ","
        else
          set needsComma to true
        end if
        
        set output to output & tabJson
      end repeat
    end repeat
    
    set output to output & "]"
    return output
  end tell
  
  on escapeForJson(str)
    set escapedStr to str
    
    -- Escape backslashes first
    set AppleScript's text item delimiters to "\\\\"
    set parts to text items of escapedStr
    set AppleScript's text item delimiters to "\\\\\\\\"
    set escapedStr to parts as string
    
    -- Escape quotes
    set AppleScript's text item delimiters to "\\""
    set parts to text items of escapedStr
    set AppleScript's text item delimiters to "\\\\\\""
    set escapedStr to parts as string
    
    -- Escape newlines
    set AppleScript's text item delimiters to return
    set parts to text items of escapedStr
    set AppleScript's text item delimiters to "\\\\n"
    set escapedStr to parts as string
    
    -- Escape tabs
    set AppleScript's text item delimiters to tab
    set parts to text items of escapedStr
    set AppleScript's text item delimiters to "\\\\t"
    set escapedStr to parts as string
    
    set AppleScript's text item delimiters to ""
    return escapedStr
  end escapeForJson
`;

// Focus specific tab by window index and tab index
const scriptToFocusTab = (windowId: string, tabId: string) => `
  tell application "iTerm"
    -- First activate the application
    activate
    
    try
      set wIndex to ${windowId} as integer
      set tIndex to ${tabId} as integer
      
      -- Get the window by index
      set w to window wIndex
      
      -- Make sure the window is not miniaturized
      if miniaturized of w then
        set miniaturized of w to false
      end if
      
      -- Get the tab by index
      set t to tab tIndex of w
      
      -- Select the window and tab
      tell w
        select t
      end tell
      
      -- Bring window to front
      set index of w to 1
      
      return "true|Successfully focused tab"
    on error errMsg
      return "false|Error: " & errMsg
    end try
  end tell
`;

export default function Command() {
  const [hasPermissionError, setHasPermissionError] = useState<boolean>(false);
  const [tabs, setTabs] = useState<ItermTab[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [scriptError, setScriptError] = useState<string | null>(null);
  const preferences = getPreferenceValues<Preferences>();

  // Load favorites from storage
  const loadFavorites = useCallback(async () => {
    try {
      const storedFavorites = await LocalStorage.getItem<string>(FAVORITES_STORAGE_KEY);
      if (storedFavorites) {
        const favSet = new Set(JSON.parse(storedFavorites));
        setFavorites(favSet as Set<string>);
        return favSet;
      }
    } catch (error) {
      // Failed to load favorites
    }
    return new Set<string>();
  }, []);

  // Save favorites to storage
  const saveFavorites = useCallback(async (newFavorites: Set<string>) => {
    try {
      await LocalStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...newFavorites]));
    } catch (error) {
      // Failed to save favorites
    }
  }, []);

  const toggleFavorite = useCallback(async (tabKey: string) => {
    const newFavorites = new Set(favorites);
    if (newFavorites.has(tabKey)) {
      newFavorites.delete(tabKey);
    } else {
      newFavorites.add(tabKey);
    }
    setFavorites(newFavorites);
    await saveFavorites(newFavorites);
    
    // Update the tabs to reflect the new favorite status
    setTabs(prevTabs => 
      prevTabs.map(tab => ({
        ...tab,
        isFavorite: newFavorites.has(`${tab.windowId}-${tab.tabId}`)
      }))
    );
  }, [favorites, saveFavorites]);

  const loadTabs = useCallback(async (favoritesSet?: Set<string>) => {
    setScriptError(null);
    try {
      const result = await runAppleScript(scriptToListTabs);

      // Parse the returned JSON
      try {
        const tabData = JSON.parse(result);
        const currentFavorites = favoritesSet || favorites;
        const tabList = tabData.map((tab: { windowId: string; tabId: string; sessionId: string; name: string; windowName: string }) => ({
          windowId: tab.windowId,
          tabId: tab.tabId,
          sessionId: tab.sessionId,
          name: tab.name,
          windowName: tab.windowName,
          isFavorite: currentFavorites.has(`${tab.windowId}-${tab.tabId}`)
        }));
        
        setTabs(tabList);
      } catch (parseError) {
        setScriptError(`JSON parsing error: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
        
        await showToast({
          style: Toast.Style.Failure,
          title: "Failed to parse tab data",
          message: parseError instanceof Error ? parseError.message : "Unknown parsing error",
        });
      }
    } catch (error: unknown) {
      if (error instanceof Error && isPermissionError(error.message)) {
        setHasPermissionError(true);
        return;
      }
      
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      setScriptError(`AppleScript error: ${errorMessage}`);
      
      await showToast({
        style: Toast.Style.Failure,
        title: "Cannot list iTerm tabs",
        message: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  }, [favorites]);

  const focusTab = async (windowId: string, tabId: string) => {
    try {
      const result = await runAppleScript(scriptToFocusTab(windowId, tabId));
      const [success, debugInfo] = result.split("|", 2);
      
      if (success === "true") {
        await closeMainWindow();
        await popToRoot();
      } else {
        await showToast({
          style: Toast.Style.Failure,
          title: "Cannot focus tab",
          message: debugInfo || "The tab may have been closed",
        });
      }
    } catch (error: unknown) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Cannot focus tab",
        message: error instanceof Error ? error.message : "Unknown error occurred",
      });
    }
  };

  // Load favorites and tabs on mount
  useEffect(() => {
    const init = async () => {
      const favs = await loadFavorites();
      await loadTabs(favs as Set<string>);
    };
    init();
  }, []);

  if (hasPermissionError) return <PermissionErrorScreen />;

  // Filter out generic/duplicate names and sort
  const genericNames = ['-zsh', 'zsh', 'bash', '-bash', 'sh', 'login'];
  const seenNames = new Set<string>();
  
  const filteredTabs = tabs.filter(tab => {
    // Skip generic shell names if preference is set
    const isGeneric = genericNames.some(generic => 
      tab.name.toLowerCase() === generic.toLowerCase() ||
      tab.name.toLowerCase() === generic
    );
    
    // If showing only named tabs, skip generic ones
    if (preferences.showOnlyNamedTabs !== false && isGeneric && !tab.isFavorite) {
      return false;
    }
    
    // Skip if we've already seen this exact name (unless it's favorited)
    if (!tab.isFavorite && seenNames.has(tab.name)) {
      return false;
    }
    
    seenNames.add(tab.name);
    
    return true;
  });
  
  // Sort tabs to show favorites first, then by name
  const sortedTabs = [...filteredTabs].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search tabs by name..."
    >
      {scriptError && (
        <List.EmptyView
          title="Error retrieving tabs"
          description={scriptError}
          icon={{ source: "exclamationmark.triangle", tintColor: Toast.Style.Failure }}
        />
      )}
      {!scriptError && sortedTabs.length === 0 && !isLoading && (
        <List.EmptyView
          title="No iTerm tabs found"
          description={preferences.showOnlyNamedTabs !== false 
            ? "No named tabs found. Try disabling 'Show Only Named Tabs' in preferences to see all tabs."
            : "Open a new iTerm window or tab to see it listed here"}
          icon={Icon.Terminal}
        />
      )}
      {sortedTabs.map((tab) => (
        <List.Item
          key={`${tab.windowId}-${tab.tabId}`}
          title={tab.name || `Tab ${tab.tabId}`}
          subtitle={`Window: ${tab.windowName}`}
          icon={tab.isFavorite 
            ? { source: Icon.Star, tintColor: Color.Yellow } 
            : Icon.Terminal
          }
          actions={
            <ActionPanel>
              <Action
                title="Open Tab"
                icon={Icon.ArrowRightCircle}
                onAction={() => focusTab(tab.windowId, tab.tabId)}
              />
              <Action
                title={tab.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
                icon={tab.isFavorite ? Icon.StarDisabled : Icon.Star}
                shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
                onAction={() => toggleFavorite(`${tab.windowId}-${tab.tabId}`)}
              />
              <Action
                title="Refresh Tab List"
                icon={Icon.ArrowClockwise}
                shortcut={{ modifiers: ["cmd"], key: "r" }}
                onAction={loadTabs}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}