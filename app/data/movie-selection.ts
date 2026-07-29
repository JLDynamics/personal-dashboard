import type { Movie } from "./types";

export const RECENT_RELEASE_WINDOW_DAYS = 120;

const RECENT_RELEASE_WINDOW_MS =
  RECENT_RELEASE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const REJECTED_EDITIONS = new Set<Movie["sourceEdition"]>([
  "re-release",
  "restoration",
  "hd-upgrade",
]);

function movieKey(movie: Movie): string {
  return movie.sourceId || `${movie.title.trim().toLowerCase()}:${movie.year}`;
}

export function isGenuinelyNewRelease(
  movie: Movie,
  now = new Date(),
): boolean {
  const releaseTime = new Date(movie.originalReleaseDate).getTime();
  const age = now.getTime() - releaseTime;

  return (
    Number.isFinite(releaseTime) &&
    age >= 0 &&
    age <= RECENT_RELEASE_WINDOW_MS &&
    !REJECTED_EDITIONS.has(movie.sourceEdition)
  );
}

export function selectNewReleaseMovies(
  candidates: Movie[],
  now = new Date(),
): Movie[] {
  const unique = new Map<string, Movie>();

  for (const candidate of candidates) {
    const key = movieKey(candidate);
    if (!unique.has(key)) unique.set(key, candidate);
  }

  return [...unique.values()]
    .filter((candidate) => isGenuinelyNewRelease(candidate, now))
    .sort(
      (a, b) =>
        new Date(b.sourceAddedAt).getTime() -
        new Date(a.sourceAddedAt).getTime(),
    );
}
