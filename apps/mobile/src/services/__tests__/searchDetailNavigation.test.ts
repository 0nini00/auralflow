import { describe, expect, it } from "vitest";
import type { SearchAlbumResult, SearchArtistResult, SearchPlaylistResult } from "@/services/musicApi";
import {
  backFromSearchDetail,
  openAlbumArtistDetail,
  openSearchAlbumDetail,
  openSearchArtistDetail,
  openSearchPlaylistDetail,
  type SearchDetailRoute,
} from "@/services/searchDetailNavigation";

const artist: SearchArtistResult = {
  id: "artist-1",
  name: "Artist",
  source: "wy",
};

const album: SearchAlbumResult = {
  id: "album-1",
  name: "Album",
  artistName: "Artist",
  source: "wy",
};

const playlist: SearchPlaylistResult = {
  id: "playlist-1",
  name: "Playlist",
  creatorName: "Creator",
  coverUrl: "https://example.test/cover.jpg",
  trackCount: 12,
  playCount: 34,
  source: "wy",
};

describe("search detail navigation", () => {
  it("opens only supported Netease detail routes", () => {
    expect(openSearchArtistDetail(artist)).toEqual({ type: "artist", artist, parentAlbum: null });
    expect(openSearchAlbumDetail(album)).toEqual({ type: "album", album, parentArtist: null });
    expect(openSearchPlaylistDetail(playlist)).toEqual({
      type: "playlist",
      playlist: {
        id: "playlist-1",
        name: "Playlist",
        author: "Creator",
        picUrl: "https://example.test/cover.jpg",
        coverImgUrl: "https://example.test/cover.jpg",
        trackCount: 12,
        playCount: 34,
        source: "wy",
      },
    });

    expect(openSearchArtistDetail({ ...artist, source: "tx" })).toBeNull();
    expect(openSearchAlbumDetail({ ...album, source: "tx" })).toBeNull();
    expect(openSearchPlaylistDetail({ ...playlist, source: "tx" })).toEqual({
      type: "playlist",
      playlist: {
        id: "playlist-1",
        name: "Playlist",
        author: "Creator",
        picUrl: "https://example.test/cover.jpg",
        coverImgUrl: "https://example.test/cover.jpg",
        trackCount: 12,
        playCount: 34,
        source: "tx",
      },
    });
  });

  it("returns from album to parent artist when album is opened inside artist detail", () => {
    const route: SearchDetailRoute = { type: "album", album, parentArtist: artist };

    expect(backFromSearchDetail(route)).toEqual({ type: "artist", artist, parentAlbum: null });
  });

  it("opens an album artist route when album detail includes artist id", () => {
    expect(openAlbumArtistDetail({ ...album, artistId: "artist-1" })).toEqual({
      type: "artist",
      artist: {
        id: "artist-1",
        name: "Artist",
        source: "wy",
      },
      parentAlbum: null,
    });
    expect(openAlbumArtistDetail(album)).toBeNull();
  });

  it("returns from an album artist detail to the parent album", () => {
    const parentAlbum = openSearchAlbumDetail(album);
    expect(parentAlbum).not.toBeNull();

    const route = openAlbumArtistDetail({ ...album, artistId: "artist-1" }, parentAlbum);

    expect(route).toEqual({
      type: "artist",
      artist: {
        id: "artist-1",
        name: "Artist",
        source: "wy",
      },
      parentAlbum,
    });
    expect(backFromSearchDetail(route)).toEqual(parentAlbum);
  });

  it("returns to search results for top level details", () => {
    expect(backFromSearchDetail(openSearchArtistDetail(artist))).toBeNull();
    expect(backFromSearchDetail({ type: "album", album, parentArtist: null })).toBeNull();
    expect(backFromSearchDetail(openSearchPlaylistDetail(playlist))).toBeNull();
  });
});
