import React, { useEffect, useRef } from 'react';
import { NPool, NRelay1 } from '@nostrify/nostrify';
import { NostrContext } from '@nostrify/react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppContext } from '@/hooks/useAppContext';

interface NostrProviderProps {
  children: React.ReactNode;
}

const NostrProvider: React.FC<NostrProviderProps> = (props) => {
  const { children } = props;
  const { config } = useAppContext();
  const queryClient = useQueryClient();
  const pool = useRef<NPool | undefined>(undefined);
  const relayMetadata = useRef(config.relayMetadata);

  useEffect(() => {
    relayMetadata.current = config.relayMetadata;
    queryClient.invalidateQueries({ queryKey: ['nostr'] });
  }, [config.relayMetadata, queryClient]);

  if (!pool.current) {
    const stableRelays = [
      'wss://nos.lol',
      'wss://140.f7z.io',
      'wss://relays.land/spatianostra',
      'wss://pyramid.fiatjaf.com',
      'wss://relay.damus.io',
    ];
    const configRelays = relayMetadata.current.relays.map(r => r.url);
    const usedRelays = configRelays.length > 0 && configRelays.some(r => r.includes('nostr.band') || r.includes('ditto.pub'))
      ? stableRelays
      : configRelays.length > 0 ? configRelays : stableRelays;

    pool.current = new NPool({
      open: (url: string) => new NRelay1(url),
      reqRouter: async (filters) => {
        // Route requests to all relay URLs
        return new Map(usedRelays.map(url => [url, filters]));
      },
      eventRouter: async () => {
        // Route events to all relay URLs
        return usedRelays;
      },
    });
  }

  return (
    <NostrContext.Provider value={{ nostr: pool.current }}>
      {children}
    </NostrContext.Provider>
  );
};

export default NostrProvider;