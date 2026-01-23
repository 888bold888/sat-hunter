import { useState } from 'react';
import { User, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  DrawerClose,
} from '@/components/ui/drawer';
import { EditProfileForm } from '@/components/EditProfileForm';
import { useIsMobile } from '@/hooks/useIsMobile';

interface ProfileModalProps {
  children?: React.ReactNode;
  className?: string;
}

export function ProfileModal({ children, className }: ProfileModalProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          {children || (
            <Button variant="outline" size="sm" className={className}>
              <User className="h-4 w-4 mr-2" />
              Edit Profile
            </Button>
          )}
        </DrawerTrigger>
        <DrawerContent className="h-[90vh]">
          <DrawerHeader className="text-center relative">
            <DrawerClose asChild>
              <Button variant="ghost" size="sm" className="absolute right-4 top-4">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </DrawerClose>
            <DrawerTitle className="flex items-center justify-center gap-2 pt-2">
              <User className="h-5 w-5" />
              Edit Profile
            </DrawerTitle>
            <DrawerDescription>
              Update your profile to receive sats and connect with other players.
            </DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-8">
            <EditProfileForm />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="outline" size="sm" className={className}>
            <User className="h-4 w-4 mr-2" />
            Edit Profile
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Edit Profile
          </DialogTitle>
          <DialogDescription>
            Update your profile to receive sats and connect with other players.
          </DialogDescription>
        </DialogHeader>
        <EditProfileForm />
      </DialogContent>
    </Dialog>
  );
}
