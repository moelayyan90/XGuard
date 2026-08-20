import { describe, expect, it } from "vitest";
import {
  childSafetyAudioSampleSegments,
  childSafetyVideoSampleTimestamps,
} from "../packages/sdk/src/child-safety-browser-media.js";

describe("child safety browser media preprocessing", () => {
  it("spreads video frame samples across the full duration", () => {
    const samples = childSafetyVideoSampleTimestamps(60, 6);
    expect(samples).toHaveLength(6);
    expect(samples[0]).toBeGreaterThanOrEqual(0);
    expect(samples[5]).toBeLessThan(60);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThan(samples[index - 1] ?? 0);
    }
  });

  it("samples beginning middle and end audio for long videos", () => {
    const segments = childSafetyAudioSampleSegments(600, 180);
    expect(segments).toHaveLength(3);
    expect(segments[0]?.offset).toBe(0);
    expect(segments[0]?.duration).toBe(60);
    expect(segments[1]?.offset).toBeGreaterThan(200);
    expect(segments[2]?.offset).toBe(540);
    expect(segments.reduce((sum, segment) => sum + segment.duration, 0)).toBe(180);
  });

  it("keeps the full audio when the video is shorter than the cap", () => {
    expect(childSafetyAudioSampleSegments(45, 180)).toEqual([
      { offset: 0, duration: 45 },
    ]);
  });
});
