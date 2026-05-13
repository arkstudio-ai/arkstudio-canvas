import { useEffect, useState } from 'react';
import { clipboardStore } from '../../store/clipboardStore';

export function useClipboardDrawerOpen() {
  const [open, setOpen] = useState(() => clipboardStore.getState().isDrawerOpen);

  useEffect(() => {
    const unsubscribe = clipboardStore.subscribe(() => {
      setOpen(clipboardStore.getState().isDrawerOpen);
    });
    return unsubscribe;
  }, []);

  return open;
}



































