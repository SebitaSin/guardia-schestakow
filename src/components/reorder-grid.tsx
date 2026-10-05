import { GripVertical } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const PREFIX = "schestakow.order.";

function readOrder(key: string): string[] {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeOrder(key: string, ids: string[]) {
  localStorage.setItem(PREFIX + key, JSON.stringify(ids));
}

function applyOrder<T>(items: T[], getId: (item: T) => string, order: string[]): T[] {
  const map = new Map(items.map((item) => [getId(item), item]));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const id of order) {
    const item = map.get(id);
    if (item) {
      out.push(item);
      seen.add(id);
    }
  }
  for (const item of items) {
    const id = getId(item);
    if (!seen.has(id)) out.push(item);
  }
  return out;
}

export function ReorderGrid<T>({
  items,
  getId,
  storageKey,
  className,
  render,
}: {
  items: T[];
  getId: (item: T) => string;
  storageKey: string;
  className?: string;
  render: (item: T) => ReactNode;
}) {
  const [order, setOrder] = useState<string[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const dragged = useRef(false);

  useEffect(() => {
    setOrder(readOrder(storageKey));
  }, [storageKey]);

  const ordered = useMemo(() => applyOrder(items, getId, order), [items, getId, order]);

  function commit(fromId: string, toId: string) {
    if (fromId === toId) return;
    const ids = ordered.map(getId);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setOrder(next);
    writeOrder(storageKey, next);
  }

  return (
    <ul className={className}>
      {ordered.map((item) => {
        const id = getId(item);
        return (
          <li
            key={id}
            draggable
            onDragStart={(e) => {
              dragged.current = false;
              e.dataTransfer.setData("text/plain", id);
              e.dataTransfer.effectAllowed = "move";
              const node = e.currentTarget;
              e.dataTransfer.setDragImage(node, Math.min(40, node.offsetWidth / 4), 24);
              setDragging(id);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (over !== id) setOver(id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = e.dataTransfer.getData("text/plain");
              commit(from, id);
              dragged.current = true;
              setOver(null);
              setDragging(null);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onClickCapture={(e) => {
              if (dragged.current) {
                e.preventDefault();
                e.stopPropagation();
                dragged.current = false;
              }
            }}
            className={cn(
              "relative cursor-grab touch-manipulation active:cursor-grabbing",
              dragging === id && "opacity-40",
              over === id && dragging && dragging !== id && "ring-2 ring-primary",
            )}
          >
            <span className="pointer-events-none absolute right-2 top-2 z-10 text-subtle">
              <GripVertical className="size-4" strokeWidth={1.75} />
            </span>
            {render(item)}
          </li>
        );
      })}
    </ul>
  );
}
