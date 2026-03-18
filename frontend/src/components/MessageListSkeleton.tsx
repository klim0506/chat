/**
 * Skeleton placeholder for the message list while messages are loading.
 * 2–3 pseudo-messages (left/right) to reduce layout shift and perceived wait.
 */
export function MessageListSkeleton() {
  return (
    <div className="flex flex-col gap-3 py-2 px-1" aria-hidden>
      {/* Left (other) */}
      <div className="flex items-end gap-2 max-w-[85%]">
        <div className="w-8 h-8 rounded-full bg-slate-200 shrink-0 animate-pulse" />
        <div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 min-w-[80px] max-w-[200px] animate-pulse">
          <div className="h-3 bg-slate-200 rounded w-full" />
          <div className="h-3 bg-slate-200 rounded w-3/4 mt-2" />
        </div>
      </div>
      {/* Right (mine) */}
      <div className="flex items-end justify-end gap-2 max-w-[85%] ml-auto">
        <div className="rounded-2xl rounded-br-md bg-blue-100 px-4 py-3 min-w-[100px] max-w-[180px] animate-pulse">
          <div className="h-3 bg-blue-200 rounded w-full" />
        </div>
        <div className="w-8 h-8 rounded-full bg-slate-200 shrink-0 animate-pulse" />
      </div>
      {/* Left (other) */}
      <div className="flex items-end gap-2 max-w-[85%]">
        <div className="w-8 h-8 rounded-full bg-slate-200 shrink-0 animate-pulse" />
        <div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 min-w-[120px] max-w-[220px] animate-pulse">
          <div className="h-3 bg-slate-200 rounded w-full" />
          <div className="h-3 bg-slate-200 rounded w-5/6 mt-2" />
          <div className="h-3 bg-slate-200 rounded w-1/2 mt-2" />
        </div>
      </div>
    </div>
  );
}
