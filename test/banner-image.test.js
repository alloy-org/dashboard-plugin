import {
  BANNER_IMAGE_NAMES,
  bannerImageNameFromSetting,
  bannerImageURLFromBannerImageName,
  DEFAULT_BANNER_IMAGE_NAME,
  NO_BANNER_IMAGE_NAME,
} from "dashboard/banner-image";

describe("banner image", () => {
  it("offers ample-web's 30 preset banners, with mountains as the default", () => {
    expect(BANNER_IMAGE_NAMES).toHaveLength(30);
    expect(BANNER_IMAGE_NAMES).toContain(DEFAULT_BANNER_IMAGE_NAME);
    expect(DEFAULT_BANNER_IMAGE_NAME).toBe("mountains");
  });

  it("uses the default banner until the user picks one", () => {
    expect(bannerImageNameFromSetting(undefined)).toBe("mountains");
    expect(bannerImageNameFromSetting("")).toBe("mountains");
    expect(bannerImageNameFromSetting("no-longer-offered")).toBe("mountains");
  });

  it("keeps a stored preset or a turned-off banner", () => {
    expect(bannerImageNameFromSetting("aurora")).toBe("aurora");
    expect(bannerImageNameFromSetting(" Camera-Gear ")).toBe("camera-gear");
    expect(bannerImageNameFromSetting(NO_BANNER_IMAGE_NAME)).toBe(NO_BANNER_IMAGE_NAME);
  });

  it("builds ample-web's asset URL for a preset, and none when the banner is off", () => {
    expect(bannerImageURLFromBannerImageName("mountains"))
      .toBe("https://assets.amplenote.com/assets/banners/banner-mountains.jpg");
    expect(bannerImageURLFromBannerImageName(NO_BANNER_IMAGE_NAME)).toBeNull();
    expect(bannerImageURLFromBannerImageName(null)).toBeNull();
  });
});
