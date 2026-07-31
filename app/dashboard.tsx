"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readSavedDashboard, refreshDashboard } from "./data/dashboard-store";
import { formatDashboardClock } from "./data/dashboard-time-zone";
import { sampleData } from "./data/sample-data";
import { recordTechNewsClick } from "./data/tech-news-selection";
import type {
  CalendarEvent,
  DashboardData,
  HourForecast,
  NewsItem,
} from "./data/types";

const conditionIcon: Record<HourForecast["condition"], string> = {
  Clear: "☀",
  Cloudy: "☁",
  Rain: "☂",
  Storm: "ϟ",
};

function SourceMark({ source }: { source: NewsItem["source"] }) {
  const shortName: Record<NewsItem["source"], string> = {
    "X Explore": "X",
    "Hacker News": "HN",
    MobileSyrup: "MS",
    Wccftech: "W",
    "iPhone in Canada": "iC",
    "The Verge": "V",
    YFSP: "Y",
  };

  return <span className={`source-mark source-${shortName[source].toLowerCase()}`}>{shortName[source]}</span>;
}

function SectionHeading({
  eyebrow,
  title,
  meta,
}: {
  eyebrow: string;
  title: string;
  meta?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {meta ? <span className="section-meta">{meta}</span> : null}
    </div>
  );
}

function formatRefreshTime(value: string, timeZone: string) {
  return formatDashboardClock(value, timeZone);
}

function formatLibraryTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function localDate(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(new Date());
}

function localGreeting(timeZone: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-CA", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function calendarDateKey(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(value);
}

function scheduleDayLabel(value: string, timeZone: string) {
  const date = new Date(value);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1_000);
  const key = calendarDateKey(date, timeZone);
  if (key === calendarDateKey(today, timeZone)) return "Today";
  if (key === calendarDateKey(tomorrow, timeZone)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date);
}

function scheduleTimeLabel(event: CalendarEvent, timeZone: string) {
  if (event.allDay) return "All day";
  return formatDashboardClock(event.startAt, timeZone);
}

function sparklineHeights(history: number[]) {
  if (!history.length) return [50];
  const minimum = Math.min(...history);
  const maximum = Math.max(...history);
  const range = maximum - minimum || 1;
  return history.map((price) => 18 + ((price - minimum) / range) * 72);
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData>(sampleData);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState("Saved view");

  const runRefresh = useCallback(async (background = false) => {
    setRefreshing(true);
    if (!background) setRefreshNote("Checking sources…");
    const current = readSavedDashboard();
    const next = await refreshDashboard(current, !background);
    setData(next);
    setRefreshing(false);
    const refreshFailed = next.savedAt === current.savedAt;
    setRefreshNote(
      refreshFailed
        ? "Saved view · refresh unavailable"
        : background
          ? "Live sources updated"
          : "Refresh complete",
    );
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedTheme = window.localStorage.getItem("dashboard-theme");
      const preferred = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const nextTheme = savedTheme === "dark" || (!savedTheme && preferred) ? "dark" : "light";
      setTheme(nextTheme);
      document.documentElement.dataset.theme = nextTheme;
      setData(readSavedDashboard());
      void runRefresh(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [runRefresh]);

  function toggleTheme() {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("dashboard-theme", nextTheme);
  }

  const stormHours = useMemo(
    () => data.weather.hours.filter((hour) => hour.condition === "Storm" || hour.condition === "Rain"),
    [data.weather.hours],
  );
  const greeting = `${localGreeting(data.weather.timeZone)}${
    data.profile.displayName ? `, ${data.profile.displayName}` : ""
  }`;

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div className="brand">
            <span className="brand-mark">D</span>
          <div>
            <span className="brand-name">Daily Brief</span>
            <span className="brand-date">{localDate(data.weather.timeZone)}</span>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="saved-state">
            <span className={`status-dot ${refreshing ? "is-refreshing" : ""}`} />
            <span>{refreshNote}</span>
            <span className="last-updated">
              at {formatRefreshTime(data.savedAt, data.weather.timeZone)}
            </span>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            {theme === "light" ? "☾" : "☀"}
          </button>
          <button
            className="refresh-button"
            type="button"
            onClick={() => void runRefresh(false)}
            disabled={refreshing}
          >
            <span className={refreshing ? "refresh-glyph spinning" : "refresh-glyph"}>↻</span>
            {refreshing ? "Refreshing" : "Refresh now"}
          </button>
        </div>
      </header>

      <section className="welcome">
        <div>
          <p className="welcome-kicker">{greeting}</p>
          <h1>Here’s what’s worth your attention.</h1>
        </div>
        <p className="welcome-copy">
          A calm read of AI, tech, weather, markets and what’s new tonight.
        </p>
      </section>

      <div className="dashboard-grid">
        <div className="dashboard-column dashboard-column-main">
          <section className="card trends-card">
          <SectionHeading eyebrow="Your signal" title="Trending AI now" />
          <a className="lead-story" href={data.trends[0].destinationUrl} target="_blank" rel="noreferrer">
            <div className="story-meta">
              <span className="article-order" data-order="1">#1</span>
              <span className="meta-separator">·</span>
              <span>{data.trends[0].signal}</span>
              <span className="meta-separator">·</span>
              <span>{data.trends[0].age}</span>
            </div>
            <h3>{data.trends[0].title}</h3>
            <p>{data.trends[0].summary}</p>
          </a>
          <div className="story-list">
            {data.trends.slice(1).map((item, index) => (
              <a className="story-row" href={item.destinationUrl} target="_blank" rel="noreferrer" key={item.id}>
                <div>
                  <div className="story-meta">
                    <span className="article-order" data-order={index + 2}>#{index + 2}</span>
                    <span className="meta-separator">·</span>
                    <span>{item.signal}</span>
                    <span className="meta-separator">·</span>
                    <span>{item.age}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.summary}</p>
                </div>
              </a>
            ))}
          </div>
          <div className="hn-story-list">
            {data.hnTrends.map((item, index) => (
              <article className="hn-story-row" key={item.id}>
                <a
                  className="hn-article-link"
                  href={item.destinationUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <div className="story-meta">
                    <span className="article-order" data-order={index + 4}>#{index + 4}</span>
                    <span className="meta-separator">·</span>
                    <span>{item.score} points</span>
                    <span className="meta-separator">·</span>
                    <span>{item.commentCount} comments</span>
                    <span className="meta-separator">·</span>
                    <span>{item.age}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.summary}</p>
                </a>
              </article>
            ))}
          </div>
          </section>

          <section className="card tech-card">
            <SectionHeading eyebrow="Discovery mix" title="Tech news" />
            <div className="tech-list">
              {data.techNews.map((item) => (
                <a
                  href={item.destinationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="tech-item"
                  key={item.id}
                  onClick={() => recordTechNewsClick(item)}
                >
                  <SourceMark source={item.source} />
                  <div>
                    <div className="story-meta">
                      <span>{item.source}</span>
                      <span className="meta-separator">·</span>
                      <span>{item.age}</span>
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.summary}</p>
                  </div>
                </a>
              ))}
            </div>
          </section>

          <section className="card library-card">
            <SectionHeading
              eyebrow="My Library"
              title="Past 7 Days"
              meta={data.sourceStatus.library}
            />
            {data.library.length ? (
              <div className="library-list">
                {data.library.map((note) => (
                  <details className="library-note" key={note.id}>
                    <summary>
                      <span className="library-note-main">
                        <span className="library-note-meta">
                          <time dateTime={note.savedAt}>
                            {formatLibraryTime(
                              note.savedAt,
                              data.weather.timeZone,
                            )}
                          </time>
                          <span className="meta-separator">·</span>
                          <span>
                            {note.tags.length
                              ? `${note.tags.length} ${note.tags.length === 1 ? "tag" : "tags"}`
                              : "No tags"}
                          </span>
                        </span>
                        <span className="library-note-title">{note.title}</span>
                        <span className="library-note-summary">
                          {note.summary}
                        </span>
                        {note.tags.length ? (
                          <span className="library-tags" aria-label="Note tags">
                            {note.tags.map((tag) => (
                              <span className="library-tag" key={tag}>
                                {tag}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </span>
                      <span className="library-disclosure" aria-hidden="true">
                        ›
                      </span>
                    </summary>
                    <div className="library-note-full">
                      <span className="library-note-full-label">
                        Full Markdown note
                      </span>
                      <pre>{note.content}</pre>
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <div className="library-state">
                <strong>
                  {data.sourceStatus.library.includes("unavailable")
                    ? "Library unavailable"
                    : "Nothing saved this week"}
                </strong>
                <p>
                  {data.sourceStatus.library.includes("unavailable")
                    ? "The configured notes folder couldn’t be read. The rest of your dashboard will keep working."
                    : "No notes were saved in the configured folder during the past 7 days."}
                </p>
              </div>
            )}
          </section>
        </div>

        <div className="dashboard-column dashboard-column-side">
          <section className="card weather-card">
          <SectionHeading eyebrow={data.weather.location} title="Weather" meta={`${data.weather.high}° / ${data.weather.low}°`} />
          <div className="weather-now">
            <div>
              <div className="temperature">{data.weather.temperature}°</div>
              <p>{data.weather.condition}</p>
              <span>Feels like {data.weather.feelsLike}°</span>
            </div>
            <div className="weather-art" aria-label={data.weather.condition}>
              <span className="sun-disc" />
              <span className="cloud-shape">☁</span>
            </div>
          </div>
          {data.weather.alert ? (
            <div className="weather-alert">
              <span className="alert-icon">ϟ</span>
              <div>
                <strong>Weather watch</strong>
                <span>{data.weather.alert}</span>
              </div>
            </div>
          ) : null}
          <div className="hourly-strip">
            {data.weather.hours.map((hour) => (
              <div className={`hour ${hour.condition === "Storm" || hour.condition === "Rain" ? "bad-weather" : ""}`} key={hour.time}>
                <span>{hour.time}</span>
                <b className="condition-icon">{conditionIcon[hour.condition]}</b>
                <strong>{hour.temperature}°</strong>
                <small>{hour.precipitation}%</small>
              </div>
            ))}
          </div>
          <p className="weather-footnote">
            {stormHours.length
              ? `${stormHours.length} wet-weather windows in the next 12 hours`
              : "No bad weather expected in the next 12 hours"}
          </p>
          </section>

          <section className="card market-card">
          <SectionHeading eyebrow="NASDAQ · USD" title="Tesla" meta={data.tesla.marketState} />
          <div className="market-value">
            <span className="ticker">TSLA</span>
            <div>
              <strong>${data.tesla.price.toFixed(2)}</strong>
              <span className={data.tesla.change >= 0 ? "positive-change" : "negative-change"}>
                {data.tesla.change >= 0 ? "↑" : "↓"} ${Math.abs(data.tesla.change).toFixed(2)} ({Math.abs(data.tesla.changePercent).toFixed(2)}%)
              </span>
            </div>
          </div>
          <div className="sparkline" aria-label="Live five day Tesla stock trend">
            {sparklineHeights(data.tesla.history).map((height, index) => (
              <span style={{ height: `${height}%` }} key={index} />
            ))}
          </div>
          <div className="market-footer">
            <span>5 day view</span>
            <span>Prices shown in USD only</span>
          </div>
          </section>

          <section className="card schedule-card">
            <SectionHeading
              eyebrow="Next 7 days"
              title="Schedule"
              meta={
                data.schedule.length
                  ? `${data.schedule.length} upcoming`
                  : "Clear"
              }
            />
            {data.schedule.length ? (
              <div className="schedule-list">
                {data.schedule.map((event) => (
                  <article className="schedule-event" key={event.id}>
                    <div className="schedule-when">
                      <strong>
                        {scheduleDayLabel(
                          event.startAt,
                          data.weather.timeZone,
                        )}
                      </strong>
                      <span>
                        {scheduleTimeLabel(event, data.weather.timeZone)}
                      </span>
                    </div>
                    <span className="calendar-dot" aria-hidden="true" />
                    <div className="schedule-details">
                      <h3>{event.title}</h3>
                      <p>
                        {event.calendarName}
                        {event.location ? ` · ${event.location}` : ""}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="schedule-empty">No upcoming events in the next 7 days.</p>
            )}
          </section>

          <section className="card movies-card">
          <SectionHeading eyebrow="Recently added" title="New movies" />
          <div className="movie-list">
            {data.movies.map((movie) => (
              <article className="movie" key={movie.id}>
                <div className={`movie-poster ${movie.posterClass}`}>
                  <img
                    className="poster-image"
                    src={movie.posterUrl}
                    alt={movie.posterAlt}
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                      event.currentTarget.parentElement?.classList.add("poster-fallback");
                    }}
                  />
                  <span className="poster-fallback-content" aria-hidden="true">
                    <span className="poster-grain" />
                    <span className="poster-monogram">{movie.monogram}</span>
                    <span className="poster-year">{movie.year}</span>
                  </span>
                </div>
                <div className="movie-details">
                  <span className="added-time">{movie.releaseLabel}</span>
                  <h3>{movie.title}</h3>
                  <div className="movie-meta">
                    <span>{movie.genre}</span>
                    {movie.rating ? <span className="rating">★ {movie.rating}</span> : null}
                  </div>
                  <p>{movie.description}</p>
                </div>
              </article>
            ))}
          </div>
          </section>
        </div>
      </div>
      <footer>
        <span>Local-first dashboard · Your personal data stays on this computer</span>
        <span>Sources refresh quietly in the background</span>
      </footer>
    </main>
  );
}
