import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface ChatUnreadContextType {
  totalUnread: number;
  channelUnread: Record<string, number>;
  activeChannelId: string | null;
  addUnread: (channelId: string) => void;
  clearChannelUnread: (channelId: string) => void;
  clearAllUnread: () => void;
  setActiveChannel: (channelId: string | null) => void;
}

const ChatUnreadContext = createContext<ChatUnreadContextType>({
  totalUnread: 0,
  channelUnread: {},
  activeChannelId: null,
  addUnread: () => {},
  clearChannelUnread: () => {},
  clearAllUnread: () => {},
  setActiveChannel: () => {},
});

export const ChatUnreadProvider = ({ children }: { children: ReactNode }) => {
  const [channelUnread, setChannelUnread] = useState<Record<string, number>>({});
  const [activeChannelId, setActiveChannelIdState] = useState<string | null>(null);

  const totalUnread = Object.values(channelUnread).reduce((a, b) => a + b, 0);

  const addUnread = useCallback((channelId: string) => {
    setChannelUnread(prev => ({ ...prev, [channelId]: (prev[channelId] ?? 0) + 1 }));
  }, []);

  const clearChannelUnread = useCallback((channelId: string) => {
    setChannelUnread(prev => {
      if (!prev[channelId]) return prev;
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
  }, []);

  const clearAllUnread = useCallback(() => setChannelUnread({}), []);

  const setActiveChannel = useCallback((channelId: string | null) => {
    setActiveChannelIdState(channelId);
    if (channelId) {
      setChannelUnread(prev => {
        if (!prev[channelId]) return prev;
        const next = { ...prev };
        delete next[channelId];
        return next;
      });
    }
  }, []);

  return (
    <ChatUnreadContext.Provider value={{ totalUnread, channelUnread, activeChannelId, addUnread, clearChannelUnread, clearAllUnread, setActiveChannel }}>
      {children}
    </ChatUnreadContext.Provider>
  );
};

export const useChatUnread = () => useContext(ChatUnreadContext);
