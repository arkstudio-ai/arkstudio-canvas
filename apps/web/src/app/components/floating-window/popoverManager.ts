/**
 * 全局活跃 popover 单例。
 * 一次只允许一个 popover 打开。
 *
 * 用法:
 *   const id = useRef(`chip-${Math.random()}`);
 *   const [open, setOpen] = useState(false);
 *   useEffect(() => popoverManager.subscribe((activeId) => {
 *     if (activeId !== id.current) setOpen(false);
 *   }), []);
 *
 *   const onClick = () => {
 *     if (open) { popoverManager.close(); setOpen(false); }
 *     else { popoverManager.open(id.current); setOpen(true); }
 *   };
 */

type Listener = (activeId: string | null) => void;

class PopoverManager {
  private activeId: string | null = null;
  private listeners = new Set<Listener>();

  get current(): string | null {
    return this.activeId;
  }

  open(id: string): void {
    if (this.activeId === id) return;
    this.activeId = id;
    this.notify();
  }

  close(): void {
    if (this.activeId === null) return;
    this.activeId = null;
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((l) => l(this.activeId));
  }
}

export const popoverManager = new PopoverManager();
