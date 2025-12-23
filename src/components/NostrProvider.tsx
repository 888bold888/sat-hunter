import React, { useEffect, useRef } from 'react';
import { NostrEvent, NostrFilter, NPool, NRelay1 } from '@nostrify/nostrify';
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
  // Create NPool instance only once
  const pool = useRef<NPool | undefined>(undefined);
  // Use refs so the pool always has the latest data
  const relayMetadata = useRef(config.relayMetadata);
  // Invalidate Nostr queries when relay metadata changes
  useEffect(() => {
    relayMetadata.current = config.relayMetadata;
    queryClient.invalidateQueries({ queryKey: ['nostr'] });
  }, [config.relayMetadata, queryClient]);
  // Initialize NPool only once with reliable relays
  if (!pool.current) {
    // Stable relays from 2025 Nostr sources (damus, nos.lol, primal, wine - avoid band/ditto as they fail)
    const stableRelays = [
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.primal.net',
      'wss://relay.nostr.wine',
    ];
    const configRelays = relayMetadata.current.relays.map(r => r.url);
    const usedRelays = configRelays.length > 0 && configRelays.some(r => r.includes('nostr.band') || r.includes('ditto.pub')) 
      ? stableRelays // Fallback if config has bad ones
      : configRelays.length > 0 ? configRelays : stableRelays;
    console.log('NostrProvider init - Config relays:', configRelays, 'Used relays:', usedRelays); // Debug log

    pool.current = new NPool({
      open(url: string) {
        console.log('Opening relay:', url); // Log connections
        return new NRelay1(url, { reconnect: true }); // Auto-reconnect on fail
      },
    });
    // Log events for debugging
    pool.current.relays.forEach(relay => {
      relay.onopen = () => console.log(`Connected to ${relay.url}`);
      relay.onclose = () => console.log(`Closed ${relay.url} - reconnecting...`);
      relay.onerror = (e) => console.error(`Error on ${relay.url}:`, e);
    });
  }
  return (
    <NostrContext.Provider value={{ nostr: pool.current }}>
      {children}
    </NostrContext.Provider>
  );
};
export default NostrProvider;