import { describe, expect, it } from 'vitest';
import { parseRequestLink } from '@app/services/requests/links';

describe('parseRequestLink', () => {
  it('reads an AniList anime as ANIME with its AniList id', () => {
    expect(parseRequestLink('https://anilist.co/anime/154587/Sousou-no-Frieren/')).toMatchObject({
      category: 'ANIME',
      externalSource: 'ANILIST',
      externalId: '154587',
    });
    expect(parseRequestLink('https://anilist.co/manga/30002')).toBeNull();
  });

  it('reads a MyAnimeList anime as ANIME with its MAL id', () => {
    expect(parseRequestLink('https://myanimelist.net/anime/52991/Sousou_no_Frieren')).toMatchObject({
      category: 'ANIME',
      externalSource: 'MAL',
      externalId: '52991',
      lookup: { type: 'mal', id: '52991' },
    });
    expect(parseRequestLink('https://myanimelist.net/manga/2')).toBeNull();
  });

  it('reads TMDB TV as a drama with the bare id ingest stores, and prefixes movies', () => {
    expect(parseRequestLink('https://www.themoviedb.org/tv/94796-hanzawa-naoki?language=ja')).toMatchObject({
      category: 'JDRAMA',
      externalSource: 'TMDB',
      externalId: '94796',
    });
    expect(parseRequestLink('https://www.themoviedb.org/movie/372058')).toMatchObject({ externalId: 'movie:372058' });
  });

  it('keeps a MyDramaList link without an identity, with a title from the slug', () => {
    expect(parseRequestLink('https://mydramalist.com/702267-the-days')).toMatchObject({
      category: 'JDRAMA',
      externalSource: null,
      externalId: null,
      lookup: { type: 'none', fallbackTitle: 'The days' },
    });
  });

  it('reads an ASIN from Audible and Amazon links', () => {
    expect(parseRequestLink('https://www.audible.co.jp/pd/some-title/B07PPMBZHX?ref=x')).toMatchObject({
      category: 'AUDIOBOOK',
      externalSource: 'ASIN',
      externalId: 'B07PPMBZHX',
      lookup: { type: 'audible', host: 'audible.co.jp' },
    });
    expect(parseRequestLink('https://www.amazon.co.jp/dp/B07PPMBZHX')).toMatchObject({
      externalId: 'B07PPMBZHX',
      lookup: { host: 'audible.co.jp' },
    });
    expect(parseRequestLink('https://www.audible.com/pd/no-asin-here')).toBeNull();
  });

  it('tells a YouTube channel from a single video', () => {
    expect(parseRequestLink('https://www.youtube.com/channel/UCip8ve30-AoX2y2OtAAmqFA')).toMatchObject({
      category: 'YOUTUBE',
      externalSource: 'YOUTUBE',
      externalId: 'UCip8ve30-AoX2y2OtAAmqFA',
    });
    expect(parseRequestLink('https://www.youtube.com/@NHK/videos')).toMatchObject({
      externalId: null,
      lookup: { type: 'youtube-channel', url: 'https://www.youtube.com/@NHK' },
    });
    expect(parseRequestLink('https://youtu.be/dQw4w9WgXcQ')).toMatchObject({ externalId: 'video:dQw4w9WgXcQ' });
    expect(parseRequestLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3')).toMatchObject({
      externalId: 'video:dQw4w9WgXcQ',
    });
  });

  it('refuses other sites and non-web schemes', () => {
    expect(parseRequestLink('https://kitsu.app/anime/21')).toBeNull();
    expect(parseRequestLink('javascript:alert(1)')).toBeNull();
    expect(parseRequestLink('not a url')).toBeNull();
  });
});
