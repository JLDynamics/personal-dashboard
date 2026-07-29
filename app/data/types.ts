export type SourceName =
  | "X Explore"
  | "Hacker News"
  | "MobileSyrup"
  | "Wccftech"
  | "iPhone in Canada"
  | "The Verge"
  | "YFSP";

export type NewsItem = {
  id: string;
  title: string;
  summary: string;
  source: SourceName;
  age: string;
  publishedAt: string;
  contentHash: string;
  destinationUrl: string;
  signal?: string;
};

export type HackerNewsItem = NewsItem & {
  source: "Hacker News";
  discussionUrl: string;
  hnRank: number;
  score: number;
  commentCount: number;
};

export type Movie = {
  id: string;
  sourceId: string;
  title: string;
  year: string;
  genre: string;
  rating?: string;
  description: string;
  sourceAddedAt: string;
  originalReleaseDate: string;
  releaseLabel: string;
  sourceEdition:
    | "source-addition"
    | "original-release"
    | "re-release"
    | "restoration"
    | "hd-upgrade";
  posterUrl: string;
  posterAlt: string;
  posterClass: string;
  monogram: string;
};

export type HourForecast = {
  time: string;
  temperature: number;
  condition: "Clear" | "Cloudy" | "Rain" | "Storm";
  precipitation: number;
};

export type CalendarEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  calendarName: string;
  location?: string;
};

export type LibraryNote = {
  id: string;
  title: string;
  savedAt: string;
  tags: string[];
  summary: string;
  content: string;
};

export type DashboardData = {
  savedAt: string;
  profile: {
    displayName: string;
  };
  sourceStatus: {
    x: string;
    hn: string;
    tech: string;
    market: string;
    weather: string;
    movies: string;
    calendar: string;
    library: string;
  };
  trends: NewsItem[];
  hnTrends: HackerNewsItem[];
  techNews: NewsItem[];
  tesla: {
    price: number;
    change: number;
    changePercent: number;
    currency: "USD";
    marketState: string;
    history: number[];
  };
  weather: {
    location: string;
    timeZone: string;
    temperature: number;
    feelsLike: number;
    condition: string;
    high: number;
    low: number;
    alert?: string;
    hours: HourForecast[];
  };
  schedule: CalendarEvent[];
  movies: Movie[];
  library: LibraryNote[];
};
