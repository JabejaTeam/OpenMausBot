// Office view (fork): one robot's walk — get up, walk the corridors to
// another office (lib/office-wander says when and which way), wave in the
// doorway, linger, walk back, sit down. Owns the robot's animation while it is
// away from its desk; seated it is the scene's again.
import * as THREE from "three";
import { LINGER_MS, pathLength, pointAlong, WALK_SPEED, type Point } from "@/lib/office-wander";

type Phase = "seated" | "rising" | "out" | "linger" | "back" | "sitting";

export interface WalkerClips {
  sitting: THREE.AnimationClip;
  standing: THREE.AnimationClip;
  walking: THREE.AnimationClip;
  idle: THREE.AnimationClip;
  wave?: THREE.AnimationClip;
}

/** getting up and sitting down take this long (the clips are quicker) */
const SIT_MS = 850;
const FADE = 0.3;

export class Walker {
  phase: Phase = "seated";
  /** the slot this bot last walked in, so one plan is walked once */
  walkedSlot = -1;
  private path: Point[] = [];
  private length = 0;
  private travelled = 0;
  private phaseStart = 0;
  private actions: Record<keyof WalkerClips, THREE.AnimationAction | null>;
  private current: THREE.AnimationAction | null = null;

  constructor(
    /** moves through the office: the robot and its hit area */
    private body: THREE.Group,
    /** the robot inside the body; its offset is the seated one */
    private avatar: THREE.Object3D,
    private seatedOffset: THREE.Vector3,
    /** the seat's own group, home of the body */
    private seat: THREE.Object3D,
    /** where a walking body lives meanwhile */
    private world: THREE.Object3D,
    private mixer: THREE.AnimationMixer,
    clips: WalkerClips,
  ) {
    const action = (clip: THREE.AnimationClip | undefined, once: boolean) => {
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      if (once) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      return a;
    };
    this.actions = {
      sitting: action(clips.sitting, true),
      standing: action(clips.standing, true),
      walking: action(clips.walking, false),
      idle: action(clips.idle, false),
      wave: action(clips.wave, true),
    };
    this.current = this.actions.sitting;
  }

  get away(): boolean {
    return this.phase !== "seated";
  }

  private play(name: keyof WalkerClips, timeScale = 1): void {
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset();
    next.timeScale = timeScale;
    next.play();
    if (this.current) this.current.crossFadeTo(next, FADE, false);
    this.current = next;
  }

  /** Set off along `path` (seat first); does nothing unless seated. */
  start(path: Point[], now: number): void {
    if (this.phase !== "seated" || path.length < 2) return;
    this.path = path;
    this.length = pathLength(path);
    this.travelled = 0;
    this.phase = "rising";
    this.phaseStart = now;
    this.play("standing", (this.actions.standing?.getClip().duration ?? 0.4) * 1000 / SIT_MS);
  }

  /** Come home now (work arrived, or the bot was opened): turn round. */
  recall(now: number): void {
    if (this.phase === "out" || this.phase === "linger") {
      this.phase = "back";
      this.phaseStart = now;
      this.play("walking");
    }
  }

  /** Where the body is, on the floor (for the camera and the markers). */
  position(target: THREE.Vector3): THREE.Vector3 {
    return this.body.getWorldPosition(target);
  }

  update(now: number, deltaSeconds: number): void {
    if (this.phase === "seated") return;
    this.mixer.update(deltaSeconds);
    const elapsed = now - this.phaseStart;
    const step = Math.min(deltaSeconds, 1 / 30) * WALK_SPEED;
    if (this.phase === "rising") {
      const t = Math.min(1, elapsed / SIT_MS);
      this.avatar.position.lerpVectors(this.seatedOffset, new THREE.Vector3(), t);
      if (t >= 1) {
        // leave the seat: the body walks the office now
        this.world.attach(this.body);
        this.phase = "out";
        this.phaseStart = now;
        this.play("walking");
      }
      return;
    }
    if (this.phase === "out" || this.phase === "back") {
      this.travelled = this.phase === "out" ? Math.min(this.length, this.travelled + step) : Math.max(0, this.travelled - step);
      const { at, heading } = pointAlong(this.path, this.travelled);
      this.body.position.set(at.x, 0, at.z);
      this.body.rotation.set(0, this.phase === "out" ? heading : heading + Math.PI, 0);
      if (this.phase === "out" && this.travelled >= this.length) {
        this.phase = "linger";
        this.phaseStart = now;
        // face into the office it visits, and wave
        this.body.rotation.set(0, Math.PI, 0);
        if (this.actions.wave) this.play("wave");
        else this.play("idle");
      } else if (this.phase === "back" && this.travelled <= 0) {
        this.seat.attach(this.body);
        this.body.position.set(0, 0, 0);
        this.body.rotation.set(0, 0, 0);
        this.phase = "sitting";
        this.phaseStart = now;
        this.play("sitting", (this.actions.sitting?.getClip().duration ?? 0.4) * 1000 / SIT_MS);
      }
      return;
    }
    if (this.phase === "linger") {
      if (this.current === this.actions.wave && elapsed > 1800) this.play("idle");
      if (elapsed > LINGER_MS) {
        this.phase = "back";
        this.phaseStart = now;
        this.play("walking");
      }
      return;
    }
    if (this.phase === "sitting") {
      const t = Math.min(1, elapsed / SIT_MS);
      this.avatar.position.lerpVectors(new THREE.Vector3(), this.seatedOffset, t);
      if (t >= 1) {
        // seated again: the pose stays put until the next walk
        this.avatar.position.copy(this.seatedOffset);
        this.phase = "seated";
      }
    }
  }
}
