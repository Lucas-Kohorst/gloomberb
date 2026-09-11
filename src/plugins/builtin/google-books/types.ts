export const GOOGLE_BOOKS_PLUGIN_ID = "google-books";
export const GOOGLE_BOOKS_CONNECTION_ID = "google-books";
export const GOOGLE_BOOKS_API_BASE_URL = "https://www.googleapis.com/books/v1";
export const GOOGLE_BOOKS_DOCUMENT_PROVIDER_ID = "google-books:volumes";

/** A single book volume from the Google Books API. */
export interface BookVolume {
  id: string;
  title: string;
  authors: string[];
  /** Raw published date as returned by the API ("2021", "2021-05", or "2021-05-11"). */
  publishedDate: string;
  /** Parsed form of publishedDate; null when the API value is missing or unusable. */
  publishedTime: Date | null;
  publisher: string;
  pageCount: number | null;
  categories: string[];
  description: string;
  infoLink: string;
}

/** A page of book search results. */
export interface BookVolumePage {
  volumes: BookVolume[];
  total: number;
}
