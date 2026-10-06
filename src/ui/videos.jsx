import { PlayCircle } from "lucide-react";

export const youtubeUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;

export function VideoGuides({ guide }) {
  return (
    <div className="my-2 space-y-2 rounded-xl border border-zinc-200 bg-white p-3 text-sm">
      <div className="font-semibold text-zinc-900">Technique {guide.videos.length > 1 ? "videos" : "video"}: {guide.exercise}</div>
      <ul className="space-y-2">
        {guide.videos.map((video) => (
          <li key={video.id}>
            <a href={youtubeUrl(video.id)} target="_blank" rel="noopener noreferrer" className="flex gap-2">
              <PlayCircle className="mt-0.5 w-5 h-5 shrink-0 text-red-600" />
              <span>
                <span className="font-semibold text-blue-700">{guide.exercise} tutorial</span>
                <span className="block text-xs text-zinc-500">{video.channel} on YouTube</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
