// NOTE: This file is stable and usually should not be modified.
// It is important that all functionality in this file is preserved, and should only be modified if explicitly requested.

import { useState } from 'react';
import { User, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import LoginDialog from './LoginDialog';
import SignupDialog from './SignupDialog';
import { useLoggedInAccounts } from '@/hooks/useLoggedInAccounts';
import { AccountSwitcher } from './AccountSwitcher';
import { cn } from '@/lib/utils';

export interface LoginAreaProps {
  className?: string;
}

export function LoginArea({ className }: LoginAreaProps) {
  const { currentUser } = useLoggedInAccounts();
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [signupDialogOpen, setSignupDialogOpen] = useState(false);

  const handleLogin = () => {
    setLoginDialogOpen(false);
    setSignupDialogOpen(false);
  };

  return (
    <div className={cn("inline-flex items-center justify-center", className)}>
      {currentUser ? (
        <AccountSwitcher onAddAccountClick={() => setLoginDialogOpen(true)} />
      ) : (
        <div className="flex gap-2 justify-center flex-shrink-0">
          <Button
            onClick={() => setLoginDialogOpen(true)}
            size="sm"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground font-medium transition-all hover:bg-primary/90 animate-scale-in text-xs whitespace-nowrap"
          >
            <User className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Log in</span>
          </Button>
          <Button
            onClick={() => setSignupDialogOpen(true)}
            variant="outline"
            size="sm"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium transition-all text-xs whitespace-nowrap"
          >
            <UserPlus className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Sign Up</span>
          </Button>
        </div>
      )}

      <LoginDialog
        isOpen={loginDialogOpen}
        onClose={() => setLoginDialogOpen(false)}
        onLogin={handleLogin}
        onSignup={() => setSignupDialogOpen(true)}
      />

      <SignupDialog
        isOpen={signupDialogOpen}
        onClose={() => setSignupDialogOpen(false)}
      />
    </div>
  );
}