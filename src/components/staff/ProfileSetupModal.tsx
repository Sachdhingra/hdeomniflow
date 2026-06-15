import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import ProfileForm from "./ProfileForm";
import type { StaffProfile } from "@/hooks/useStaffProfile";

interface Props {
  open: boolean;
  initial: StaffProfile | null;
  onComplete: () => void;
}

export default function ProfileSetupModal({ open, initial, onComplete }: Props) {
  return (
    <Dialog open={open} onOpenChange={() => { /* non-dismissible */ }}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto [&>button.absolute]:hidden"
        onPointerDownOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Welcome — let's set up your profile</DialogTitle>
          <DialogDescription>
            Please complete your profile to continue. This is shown in the staff directory and leaderboard.
          </DialogDescription>
        </DialogHeader>
        <ProfileForm
          initial={initial}
          requireAll
          submitLabel="Complete Profile"
          onSaved={(p) => { if (p.is_profile_complete) onComplete(); }}
        />
      </DialogContent>
    </Dialog>
  );
}
