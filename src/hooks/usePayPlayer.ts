import { useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import { useNWC } from '@/hooks/useNWCContext';
import { useToast } from '@/hooks/useToast';
import { nip57 } from 'nostr-tools';

interface PayPlayerResult {
  success: boolean;
  preimage?: string;
  error?: string;
}

export function usePayPlayer() {
  const { nostr } = useNostr();
  const { sendPayment, getActiveConnection } = useNWC();
  const { toast } = useToast();

  /**
   * Pay a player for capturing a monster
   * @param playerPubkey - The player's Nostr pubkey
   * @param satAmount - Amount in satoshis to pay
   * @param monsterName - Name of the captured monster (for the comment)
   * @returns Result with success status
   */
  const payPlayer = useCallback(async (
    playerPubkey: string,
    satAmount: number,
    monsterName: string
  ): Promise<PayPlayerResult> => {
    // Get the active NWC connection
    const connection = getActiveConnection();
    if (!connection || !connection.isConnected) {
      return {
        success: false,
        error: 'No NWC wallet connected. Please connect your wallet to pay players.',
      };
    }

    try {
      // Fetch the player's profile to get their Lightning address
      const profileEvents = await nostr.query(
        [{ kinds: [0], authors: [playerPubkey], limit: 1 }],
        { signal: AbortSignal.timeout(10000) }
      );

      if (profileEvents.length === 0) {
        return {
          success: false,
          error: 'Could not find player profile. They may need to set up their Nostr profile.',
        };
      }

      const profileEvent = profileEvents[0];
      let metadata: { lud06?: string; lud16?: string; name?: string };

      try {
        metadata = JSON.parse(profileEvent.content);
      } catch {
        return {
          success: false,
          error: 'Invalid player profile data.',
        };
      }

      const { lud06, lud16 } = metadata;
      if (!lud06 && !lud16) {
        return {
          success: false,
          error: `Player "${metadata.name || 'Unknown'}" has no Lightning address in their profile.`,
        };
      }

      // Get the LNURL pay endpoint
      const zapEndpoint = await nip57.getZapEndpoint(profileEvent);
      if (!zapEndpoint) {
        return {
          success: false,
          error: 'Could not resolve Lightning address. The player may need to update their profile.',
        };
      }

      // Request an invoice from the player's Lightning address
      const amountMillisats = satAmount * 1000;
      const comment = `Sat Hunter: Captured ${monsterName}! 🎯⚡`;
      const lnurlUrl = `${zapEndpoint}?amount=${amountMillisats}&comment=${encodeURIComponent(comment)}`;

      const response = await fetch(lnurlUrl);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: `Lightning service error: ${errorData.reason || response.statusText}`,
        };
      }
      const data: { pr?: string; reason?: string } = await response.json();

      const invoice = data.pr;

      if (!invoice || typeof invoice !== 'string') {
        return {
          success: false,
          error: 'Lightning service did not return a valid invoice.',
        };
      }

      // Pay the invoice using NWC
      const paymentResult = await sendPayment(connection, invoice);

      toast({
        title: `Paid ${satAmount} sats! ⚡`,
        description: `${monsterName} reward sent to player.`,
      });

      return {
        success: true,
        preimage: paymentResult.preimage,
      };
    } catch (error) {
      console.error('Payment error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown payment error';

      return {
        success: false,
        error: errorMessage,
      };
    }
  }, [nostr, getActiveConnection, sendPayment, toast]);

  return { payPlayer };
}
