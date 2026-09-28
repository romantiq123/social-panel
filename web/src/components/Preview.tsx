import { useState } from 'react';
import { Heart, MessageCircle, Repeat2, Send, Bookmark, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Channel, MediaRef, PostOptions } from '../api';
import { MediaThumb } from './MediaPicker';
import { cx } from './ui';

type M = MediaRef & { url: string };

function Avatar({ ch, size = 36 }: { ch: Channel; size?: number }) {
  return ch.avatar_url ? (
    <img src={ch.avatar_url} className="rounded-full object-cover" style={{ width: size, height: size }} referrerPolicy="no-referrer" alt="" />
  ) : (
    <div className="flex items-center justify-center rounded-full bg-zinc-300 text-sm font-semibold uppercase dark:bg-zinc-700" style={{ width: size, height: size }}>
      {ch.username[0]}
    </div>
  );
}

/** Подсветка хэштегов и упоминаний */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(#[\p{L}\p{N}_]+|@[\w.]+|https?:\/\/\S+)/gu);
  return (
    <>
      {parts.map((p, i) => (/^[#@]|^http/.test(p) ? <span key={i} className="text-blue-600 dark:text-blue-400">{p}</span> : p))}
    </>
  );
}

function ThreadsPost({ ch, text, media, last = true }: { ch: Channel; text: string; media: M[]; last?: boolean }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <Avatar ch={ch} />
        {!last && <div className="mt-1.5 w-0.5 flex-1 rounded bg-zinc-200 dark:bg-zinc-700" />}
      </div>
      <div className="min-w-0 flex-1 pb-4">
        <div className="text-sm font-semibold">
          {ch.username} <span className="font-normal text-zinc-400">· сейчас</span>
        </div>
        {text && (
          <div className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-snug">
            <RichText text={text} />
          </div>
        )}
        {media.length > 0 && (
          <div className="mt-2 flex gap-1.5 overflow-x-auto scroll-thin">
            {media.map((m) => (
              <MediaThumb key={m.id} m={m} className={cx('shrink-0 rounded-lg', media.length === 1 ? 'max-h-80 w-full' : 'h-48 w-36')} />
            ))}
          </div>
        )}
        <div className="mt-2.5 flex gap-4 text-zinc-500">
          <Heart className="size-[18px]" />
          <MessageCircle className="size-[18px]" />
          <Repeat2 className="size-[18px]" />
          <Send className="size-[18px]" />
        </div>
      </div>
    </div>
  );
}

function InstagramPost({ ch, text, media, options }: { ch: Channel; text: string; media: M[]; options: PostOptions }) {
  const [i, setI] = useState(0);
  const type = options.instagram?.type ?? 'feed';
  const cur = media[Math.min(i, media.length - 1)];
  if (type === 'story')
    return (
      <div className="relative mx-auto aspect-[9/16] w-56 overflow-hidden rounded-2xl bg-zinc-900">
        {cur && <MediaThumb m={cur} className="size-full" />}
        <div className="absolute left-3 right-3 top-2 h-0.5 rounded bg-white/60" />
        <div className="absolute left-3 top-5 flex items-center gap-2 text-xs font-semibold text-white">
          <Avatar ch={ch} size={24} /> {ch.username}
        </div>
      </div>
    );
  return (
    <div className="-mx-4">
      <div className="flex items-center gap-2.5 px-4 pb-2.5">
        <Avatar ch={ch} size={30} />
        <div className="text-sm font-semibold">{ch.username}</div>
      </div>
      <div className={cx('relative bg-zinc-100 dark:bg-zinc-800', type === 'reel' ? 'aspect-[9/16] mx-auto w-3/4' : 'aspect-[4/5]')}>
        {cur ? <MediaThumb m={cur} className="size-full" /> : <div className="flex size-full items-center justify-center text-sm text-zinc-400">Нет медиа</div>}
        {media.length > 1 && (
          <>
            {i > 0 && (
              <button onClick={() => setI(i - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-1 text-zinc-800">
                <ChevronLeft className="size-4" />
              </button>
            )}
            {i < media.length - 1 && (
              <button onClick={() => setI(i + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-1 text-zinc-800">
                <ChevronRight className="size-4" />
              </button>
            )}
            <div className="absolute right-2 top-2 rounded-full bg-zinc-900/70 px-2 py-0.5 text-xs text-white">
              {i + 1}/{media.length}
            </div>
          </>
        )}
      </div>
      <div className="flex gap-4 px-4 pt-3">
        <Heart className="size-5" />
        <MessageCircle className="size-5" />
        <Send className="size-5" />
        <Bookmark className="ml-auto size-5" />
      </div>
      {text && (
        <div className="whitespace-pre-wrap break-words px-4 pt-2 text-sm">
          <span className="font-semibold">{ch.username}</span> <RichText text={text} />
        </div>
      )}
      {options.instagram?.first_comment && (
        <div className="px-4 pt-1.5 text-sm text-zinc-500">
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">{ch.username}</span> <RichText text={options.instagram.first_comment} />
        </div>
      )}
    </div>
  );
}

export default function Preview({ ch, text, media, options }: { ch: Channel; text: string; media: M[]; options: PostOptions }) {
  if (ch.provider === 'instagram') return <InstagramPost ch={ch} text={text} media={media} options={options} />;
  const parts = (options.threads?.thread ?? []).filter((p) => p.text?.trim() || p.media?.length);
  return (
    <div>
      <ThreadsPost ch={ch} text={text} media={media} last={!parts.length} />
      {parts.map((p, i) => (
        <ThreadsPost key={i} ch={ch} text={p.text} media={(p.media ?? []) as M[]} last={i === parts.length - 1} />
      ))}
      {options.threads?.topic_tag && <div className="ml-12 text-xs text-zinc-500">Тема: {options.threads.topic_tag}</div>}
    </div>
  );
}
