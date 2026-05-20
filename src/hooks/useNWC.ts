import { useState, useCallback, useEffect, useRef } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useToast } from '@/hooks/useToast';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { LN } from '@getalby/sdk';
import { deriveStorageKey, encryptData, decryptData } from '@/lib/encryptedStorage';

const NWC_STORAGE_KEY = 'nwc-connections-encrypted';
const NWC_LEGACY_KEY = 'nwc-connections';

export interface NWCConnection {
  connectionString: string;
  alias?: string;
  isConnected: boolean;
  client?: LN;
}

export interface NWCInfo {
  alias?: string;
  color?: string;
  pubkey?: string;
  network?: string;
  methods?: string[];
  notifications?: string[];
}

export function useNWCInternal() {
  const { toast } = useToast();
  const { user } = useCurrentUser();
  const [connections, setConnections] = useState<NWCConnection[]>([]);
  const [activeConnection, setActiveConnection] = useLocalStorage<string | null>('nwc-active-connection', null);
  const [connectionInfo, setConnectionInfo] = useState<Record<string, NWCInfo>>({});
  const [isDecrypted, setIsDecrypted] = useState(false);

  // Cache the encryption key in memory (never persisted)
  const storageKeyRef = useRef<CryptoKey | null>(null);

  // Persist encrypted connections to localStorage
  const persistConnections = useCallback(async (conns: NWCConnection[]) => {
    const key = storageKeyRef.current;
    if (!key) {
      // No encryption key yet — store nothing (will encrypt when key is available)
      console.warn('No storage encryption key available, connections not persisted');
      return;
    }

    // Strip non-serializable client property
    const serializable = conns.map(({ connectionString, alias, isConnected }) => ({
      connectionString, alias, isConnected,
    }));

    const encrypted = await encryptData(key, JSON.stringify(serializable));
    localStorage.setItem(NWC_STORAGE_KEY, encrypted);
  }, []);

  // Decrypt connections from storage when signer becomes available
  useEffect(() => {
    if (!user?.signer || isDecrypted) return;

    let cancelled = false;

    (async () => {
      try {
        const key = await deriveStorageKey(user.signer);
        if (cancelled) return;
        storageKeyRef.current = key;

        // Try to decrypt existing encrypted data
        const encryptedRaw = localStorage.getItem(NWC_STORAGE_KEY);
        if (encryptedRaw) {
          const decrypted = await decryptData(key, encryptedRaw);
          if (!cancelled && decrypted) {
            const parsed = JSON.parse(decrypted) as NWCConnection[];
            setConnections(parsed);
            setIsDecrypted(true);
            return;
          }
        }

        // Migrate legacy plaintext connections if they exist
        const legacyRaw = localStorage.getItem(NWC_LEGACY_KEY);
        if (legacyRaw) {
          try {
            const legacy = JSON.parse(legacyRaw) as NWCConnection[];
            if (!cancelled && legacy.length > 0) {
              setConnections(legacy);
              // Re-encrypt and remove legacy plaintext
              const encrypted = await encryptData(key, JSON.stringify(legacy));
              localStorage.setItem(NWC_STORAGE_KEY, encrypted);
              localStorage.removeItem(NWC_LEGACY_KEY);
              console.log('Migrated NWC connections to encrypted storage');
            }
          } catch {
            // Invalid legacy data, ignore
          }
        }

        if (!cancelled) setIsDecrypted(true);
      } catch (err) {
        console.error('Failed to derive storage key:', err);
        if (!cancelled) setIsDecrypted(true); // Allow app to continue without stored connections
      }
    })();

    return () => { cancelled = true; };
  }, [user?.signer, isDecrypted]);

  // Add new connection
  const addConnection = async (uri: string, alias?: string): Promise<boolean> => {
    const parseNWCUri = (uri: string): { connectionString: string } | null => {
      try {
        if (!uri.startsWith('nostr+walletconnect://') && !uri.startsWith('nostrwalletconnect://')) {
          console.error('Invalid NWC URI protocol:', { protocol: uri.split('://')[0] });
          return null;
        }
        return { connectionString: uri };
      } catch (error) {
        console.error('Failed to parse NWC URI:', error);
        return null;
      }
    };

    const parsed = parseNWCUri(uri);
    if (!parsed) {
      toast({
        title: 'Invalid NWC URI',
        description: 'Please check the connection string and try again.',
        variant: 'destructive',
      });
      return false;
    }

    const existingConnection = connections.find(c => c.connectionString === parsed.connectionString);
    if (existingConnection) {
      toast({
        title: 'Connection already exists',
        description: 'This wallet is already connected.',
        variant: 'destructive',
      });
      return false;
    }

    try {
      let timeoutId: NodeJS.Timeout | undefined;
      const testPromise = new Promise((resolve, reject) => {
        try {
          const client = new LN(parsed.connectionString);
          resolve(client);
        } catch (error) {
          reject(error);
        }
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Connection test timeout')), 10000);
      });

      try {
        await Promise.race([testPromise, timeoutPromise]) as LN;
        if (timeoutId) clearTimeout(timeoutId);
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId);
        throw error;
      }

      const connection: NWCConnection = {
        connectionString: parsed.connectionString,
        alias: alias || 'NWC Wallet',
        isConnected: true,
      };

      setConnectionInfo(prev => ({
        ...prev,
        [parsed.connectionString]: {
          alias: connection.alias,
          methods: ['pay_invoice'],
        },
      }));

      const newConnections = [...connections, connection];
      setConnections(newConnections);
      await persistConnections(newConnections);

      if (connections.length === 0 || !activeConnection)
        setActiveConnection(parsed.connectionString);

      toast({
        title: 'Wallet connected',
        description: `Successfully connected to ${connection.alias}.`,
      });

      return true;
    } catch (error) {
      console.error('NWC connection failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

      toast({
        title: 'Connection failed',
        description: `Could not connect to the wallet: ${errorMessage}`,
        variant: 'destructive',
      });
      return false;
    }
  };

  // Remove connection
  const removeConnection = async (connectionString: string) => {
    // Clean up persistent client if it matches
    if (clientRef.current?.connectionString === connectionString) {
      clientRef.current = null;
    }

    const filtered = connections.filter(c => c.connectionString !== connectionString);
    setConnections(filtered);
    await persistConnections(filtered);

    if (activeConnection === connectionString) {
      const newActive = filtered.length > 0 ? filtered[0].connectionString : null;
      setActiveConnection(newActive);
    }

    setConnectionInfo(prev => {
      const newInfo = { ...prev };
      delete newInfo[connectionString];
      return newInfo;
    });

    toast({
      title: 'Wallet disconnected',
      description: 'The wallet connection has been removed.',
    });
  };

  // Get active connection (read-only, doesn't set state)
  const getActiveConnection = useCallback((): NWCConnection | null => {
    // If there's an active connection set, find and return it
    if (activeConnection) {
      const found = connections.find(c => c.connectionString === activeConnection);
      return found || null;
    }

    // If no active connection but connections exist, return the first one
    // (but don't set state here to avoid infinite loops)
    if (connections.length > 0) {
      return connections[0];
    }

    return null;
  }, [activeConnection, connections]);

  // Persistent NWC client instance (reused across payments)
  const clientRef = useRef<{ connectionString: string; client: LN } | null>(null);

  const getOrCreateClient = useCallback((connectionString: string): LN => {
    // Reuse existing client if connection string matches
    if (clientRef.current && clientRef.current.connectionString === connectionString) {
      return clientRef.current.client;
    }

    const client = new LN(connectionString);
    clientRef.current = { connectionString, client };
    return client;
  }, []);

  // Send payment using the SDK
  const sendPayment = useCallback(async (
    connection: NWCConnection,
    invoice: string
  ): Promise<{ preimage: string }> => {
    if (!connection.connectionString) {
      throw new Error('Invalid connection: missing connection string');
    }

    let client: LN;
    try {
      client = getOrCreateClient(connection.connectionString);
    } catch (error) {
      console.error('Failed to create NWC client:', error);
      throw new Error(`Failed to create NWC client: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Single attempt with generous timeout (Lightning payments can take time to route)
    const timeoutMs = 60000;
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Payment timeout after ${timeoutMs / 1000} seconds`)), timeoutMs);
    });

    try {
      const response = await Promise.race([client.pay(invoice), timeoutPromise]) as { preimage: string };
      if (timeoutId) clearTimeout(timeoutId);
      return response;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn('NWC payment error:', errorMessage);

      // "Payment is still pending" means LND accepted it and is routing — not failed, not confirmed
      if (errorMessage.includes('pending')) {
        console.log('Payment is pending on the node — still routing');
        throw new Error('PAYMENT_PENDING');
      }

      // Map known errors to user-friendly messages
      if (errorMessage.includes('timeout')) {
        throw new Error('Payment timed out after 60s. The payment may still complete — check your wallet.');
      } else if (errorMessage.includes('insufficient')) {
        throw new Error('Insufficient balance in connected wallet.');
      } else if (errorMessage.includes('invalid')) {
        throw new Error('Invalid invoice or connection. Please check your wallet.');
      } else if (errorMessage.includes('13194') || errorMessage.includes('info event')) {
        throw new Error('Wallet connection expired or relay unavailable. Please reconnect your NWC wallet in settings.');
      } else {
        throw new Error(`Payment failed: ${errorMessage}`);
      }
    }
  }, [getOrCreateClient]);

  return {
    connections,
    activeConnection,
    connectionInfo,
    addConnection,
    removeConnection,
    setActiveConnection,
    getActiveConnection,
    sendPayment,
  };
}
