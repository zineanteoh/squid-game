import confetti from "canvas-confetti"; // Import the library
import * as THREE from "three";
import {
	type Font,
	FontLoader,
} from "three/examples/jsm/loaders/FontLoader.js";

// --- Configuration Constants ---
const PLAYER_MOVE_SPEED = 5; // Max speed
const PLAYER_ACCELERATION = 20; // Units per second^2
const PLAYER_DECELERATION = 15; // Units per second^2 (friction/braking)
const FIELD_WIDTH = 20;
const FIELD_LENGTH = 80;
const PLAYER_START_Z = FIELD_LENGTH / 2 - 5;
const FINISH_LINE_Z = -FIELD_LENGTH / 2 + 2;
const DOLL_POSITION_Z = -FIELD_LENGTH / 2;
const DOLL_SOUND_DURATION = 5.0; // Assumed duration of doll.mp3
const DOLL_TURN_DURATION = 1.0; // Time for doll to turn 180 degrees
const RED_LIGHT_WATCH_DURATION = 2.0; // Fixed time doll watches after sound stops
const GAME_TIME_LIMIT = 60; // seconds
const DOLL_SCALE = 5; // Make the doll much larger
const MOVEMENT_DETECTION_THRESHOLD = 0.05; // How much movement triggers game over during red light
const CAMERA_OFFSET = new THREE.Vector3(0, 8, 9); // Increased Y for better view, slightly more Z distance
const EXPLOSION_PARTICLE_COUNT = 50;
const EXPLOSION_PARTICLE_SPEED = 8;
const EXPLOSION_PARTICLE_LIFETIME = 1.5; // seconds
const GRAVITY = -9.8 * 2; // A bit stronger gravity for effect
const RESPAWN_DELAY = 3.0; // seconds (Changed from 5.0 to 3.0)

// --- Game States ---
enum GameState {
	READY = "READY",
	GREEN_LIGHT = "GREEN_LIGHT",
	RED_LIGHT_TRANSITION_TO_RED = "RED_LIGHT_TRANSITION_TO_RED", // Doll turning to face player
	RED_LIGHT_WATCHING = "RED_LIGHT_WATCHING", // Doll facing player, checking movement
	RED_LIGHT_TRANSITION_TO_GREEN = "RED_LIGHT_TRANSITION_TO_GREEN", // Doll turning away
	GAME_OVER = "GAME_OVER",
	WIN = "WIN",
}

// Interface for explosion particle data
interface ExplosionParticle {
	mesh: THREE.Mesh;
	velocity: THREE.Vector3;
	life: number;
}

// New constants - MOVED OUTSIDE CLASS
const REQUIRED_DOLL_TURN_SPEED = Math.PI / DOLL_TURN_DURATION; // Radians per second needed to turn in time

export class RedLightGreenLightGame {
	private scene: THREE.Scene;
	private camera: THREE.PerspectiveCamera;
	private renderer: THREE.WebGLRenderer;
	private clock: THREE.Clock;

	// Game Elements
	private player!: THREE.Mesh;
	private doll!: THREE.Group;
	private dollHead!: THREE.Mesh; // Specific reference for turning
	private playingField!: THREE.Mesh;
	private finishLine!: THREE.Mesh;
	private font: Font | null = null; // Loaded font
	private statusElementHTML: HTMLElement | null = null; // Centered HTML status display
	private exitButtonElement: HTMLButtonElement | null = null; // Exit button
	private explosionParticles: ExplosionParticle[] = [];
	private particleGeometry: THREE.BufferGeometry | null = null; // Reusable geometry
	private particleMaterial: THREE.Material | null = null; // Reusable material

	// Audio Elements
	private audioListener: THREE.AudioListener; // Will be passed in
	private audioLoader!: THREE.AudioLoader;
	private dollSoundBuffer: AudioBuffer | null = null;
	private dollSound: THREE.Audio | null = null;

	// Game State
	private gameState: GameState = GameState.READY;
	private currentLightTimer = 0; // Time remaining in current light phase
	private gameTimer: number = GAME_TIME_LIMIT;
	private playerStartPosition = new THREE.Vector3(0, 1, PLAYER_START_Z);
	private dollTargetRotationY = 0; // Target rotation for the doll's head
	private redLightStartPosition: THREE.Vector3 = new THREE.Vector3(); // Player position when RED_LIGHT_WATCHING starts
	private respawnTimer = 0; // Timer for automatic respawn
	private gameOverReason = ""; // Store reason for game over message
	private gameOverPosition: THREE.Vector3 = new THREE.Vector3(); // Position where game ended
	private winTimer = 3; // Timer for win state countdown
	private isMuted = false; // Track mute state

	// Input & Movement State
	private keysPressed: { [key: string]: boolean } = {};
	private isMovingForwardInput = false; // Tracks key press
	private playerVelocity: THREE.Vector3 = new THREE.Vector3(); // Player's current velocity

	// Callback for exiting
	private onExitCallback: (result: "passed" | "failed" | "exited") => void;
	private gameOutcome: "passed" | "failed" | "exited" = "exited"; // Track game outcome

	// Difficulty Scaling - Removed
	// private currentMinGreenDuration = BASE_MIN_GREEN_LIGHT_DURATION;
	// private currentMaxGreenDuration = BASE_MAX_GREEN_LIGHT_DURATION;
	// private currentMinRedDuration = BASE_MIN_RED_LIGHT_DURATION;
	// private currentMaxRedDuration = BASE_MAX_RED_LIGHT_DURATION;

	constructor(
		renderer: THREE.WebGLRenderer,
		statusElement: HTMLElement | null,
		onExit: (result: "passed" | "failed" | "exited") => void,
		listener: THREE.AudioListener, // Accept the main listener
		isMuted = false, // Accept mute state
	) {
		this.renderer = renderer;
		this.statusElementHTML = statusElement;
		this.onExitCallback = onExit;
		this.audioListener = listener; // Use the passed-in listener
		this.isMuted = isMuted; // Set initial mute state

		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color(0x87ceeb);
		this.clock = new THREE.Clock();

		// Camera
		this.camera = new THREE.PerspectiveCamera(
			75,
			window.innerWidth / window.innerHeight,
			0.1,
			1000,
		);
		this.camera.position.set(0, 6, PLAYER_START_Z + 10);

		// Audio Setup - Use the passed-in listener
		// NO need to create a new listener or add it to the camera here
		this.audioLoader = new THREE.AudioLoader();

		this.loadAssetsAndInitScene();
		this.setupEventListeners();
		this.createExitButton();
	}

	// --- Initialization ---

	private loadAssetsAndInitScene(): void {
		const fontLoader = new FontLoader();
		const fontPromise = new Promise<Font>((resolve, reject) => {
			fontLoader.load(
				"/fonts/helvetiker_regular.typeface.json",
				(loadedFont) => {
					console.log("Font loaded");
					resolve(loadedFont);
				},
				undefined,
				(error) => {
					console.error("Font loading failed:", error);
					reject(error); // Reject if font fails
				},
			);
		});

		const audioPromise = new Promise<AudioBuffer>((resolve, reject) => {
			this.audioLoader.load(
				"/doll.mp3", // Path to your sound file
				(buffer) => {
					console.log("Audio loaded");
					resolve(buffer);
				},
				undefined,
				(error) => {
					console.error("Audio loading failed:", error);
					reject(error); // Reject if audio fails
				},
			);
		});

		Promise.all([fontPromise, audioPromise])
			.then(([loadedFont, loadedAudioBuffer]) => {
				this.font = loadedFont;
				this.dollSoundBuffer = loadedAudioBuffer;

				this.initScene(); // Initialize scene geometry etc.
				this.initAudio(); // Initialize audio object
				this.resetGame(); // Reset includes initial camera positioning and state
			})
			.catch((error) => {
				console.error("Error loading assets:", error);
				// Handle error: maybe show an error message
				// Attempt to initialize without failed assets
				if (!this.font) console.warn("Proceeding without 3D text.");
				if (!this.dollSoundBuffer)
					console.warn("Proceeding without doll sound.");

				this.initScene(); // Still init scene basics
				this.initAudio(); // Try to init audio even if buffer failed (it will be null)
				this.resetGame();
			});
	}

	private initAudio(): void {
		if (this.dollSoundBuffer && this.audioListener) {
			// Use the passed-in listener here
			this.dollSound = new THREE.Audio(this.audioListener);
			this.dollSound.setBuffer(this.dollSoundBuffer);
			this.dollSound.setLoop(false);
			// Apply mute state
			this.dollSound.setVolume(this.isMuted ? 0 : 0.5);
			console.log(
				`Doll sound initialized using shared listener (${this.isMuted ? "muted" : "unmuted"}).`,
			);
		} else {
			console.warn(
				"Doll sound buffer or shared listener not available for init.",
			);
		}
	}

	private initScene(): void {
		// Playing Field
		const fieldGeometry = new THREE.BoxGeometry(FIELD_WIDTH, 0.2, FIELD_LENGTH);
		const fieldMaterial = new THREE.MeshStandardMaterial({
			color: 0x98fb98,
			roughness: 0.8,
		}); // PaleGreen
		this.playingField = new THREE.Mesh(fieldGeometry, fieldMaterial);
		this.playingField.position.y = -0.1; // Slightly below origin
		this.playingField.receiveShadow = true;
		this.scene.add(this.playingField);

		// Finish Line
		const finishLineGeometry = new THREE.BoxGeometry(FIELD_WIDTH, 0.1, 0.5);
		const finishLineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff }); // White
		this.finishLine = new THREE.Mesh(finishLineGeometry, finishLineMaterial);
		this.finishLine.position.set(0, 0.06, FINISH_LINE_Z); // Slightly above ground
		this.scene.add(this.finishLine);

		// Player (Capsule)
		const playerGeometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8); // Radius, height
		const playerMaterial = new THREE.MeshStandardMaterial({
			color: 0x0077ff,
			roughness: 0.5,
		});
		this.player = new THREE.Mesh(playerGeometry, playerMaterial);
		this.player.castShadow = true;
		this.player.position.copy(this.playerStartPosition);
		this.scene.add(this.player);

		// Doll (Scaled and with Hair)
		this.doll = new THREE.Group();
		const dollBodyGeo = new THREE.CylinderGeometry(0.6, 1, 3, 16); // Base geometry
		const dollBodyMat = new THREE.MeshStandardMaterial({
			color: 0xffa500,
			roughness: 0.6,
		}); // Orange
		const dollBody = new THREE.Mesh(dollBodyGeo, dollBodyMat);
		dollBody.position.y = 1.5; // Raise body
		dollBody.castShadow = true;
		this.doll.add(dollBody);

		const dollHeadGeo = new THREE.SphereGeometry(0.7, 16, 16); // Base geometry
		const dollHeadMat = new THREE.MeshStandardMaterial({
			color: 0xffebcd,
			roughness: 0.7,
		}); // BlanchedAlmond (skin tone)
		this.dollHead = new THREE.Mesh(dollHeadGeo, dollHeadMat);
		this.dollHead.position.y = 3.5; // Position head on top of body
		this.dollHead.castShadow = true;
		this.doll.add(this.dollHead); // Add head to the group

		// Add Hair (Simple bun)
		const hairGeo = new THREE.SphereGeometry(0.8, 16, 8);
		const hairMat = new THREE.MeshStandardMaterial({
			color: 0x222222,
			roughness: 0.8,
		}); // Dark grey/black hair
		const hair = new THREE.Mesh(hairGeo, hairMat);
		hair.position.set(0, 0.4, 0.3); // Position slightly up and back on the head
		hair.scale.set(1, 1.2, 1); // Make it slightly oval
		this.dollHead.add(hair); // Add hair as child of head

		// Add Pigtails
		const pigtailGeo = new THREE.SphereGeometry(0.5, 12, 8); // Smaller spheres for pigtails
		// Reuse the hairMat

		const leftPigtail = new THREE.Mesh(pigtailGeo, hairMat);
		leftPigtail.position.set(-0.7, 0.2, 0.1); // Position on the left side
		this.dollHead.add(leftPigtail);

		const rightPigtail = new THREE.Mesh(pigtailGeo, hairMat);
		rightPigtail.position.set(0.7, 0.2, 0.1); // Position on the right side
		this.dollHead.add(rightPigtail);

		// Add Facial Features
		const eyeGeo = new THREE.SphereGeometry(0.15, 12, 8); // Geometry for sclera
		const pupilGeo = new THREE.SphereGeometry(0.08, 10, 6); // Geometry for pupil
		const scleraMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); // White
		const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 }); // Black

		// Left Eye
		const leftEye = new THREE.Mesh(eyeGeo, scleraMat);
		leftEye.position.set(-0.25, 0.1, -0.7); // Flipped Z to negative
		this.dollHead.add(leftEye);
		const leftPupil = new THREE.Mesh(pupilGeo, pupilMat);
		leftPupil.position.set(0, 0, 0.08); // Slightly in front of the sclera
		leftEye.add(leftPupil); // Add pupil to eye

		// Right Eye
		const rightEye = new THREE.Mesh(eyeGeo, scleraMat);
		rightEye.position.set(0.25, 0.1, -0.7); // Flipped Z to negative
		this.dollHead.add(rightEye);
		const rightPupil = new THREE.Mesh(pupilGeo, pupilMat);
		rightPupil.position.set(0, 0, 0.08); // Slightly in front of the sclera
		rightEye.add(rightPupil); // Add pupil to eye

		// Mouth (Simple red cylinder)
		const mouthGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16);
		const mouthMat = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Red
		const mouth = new THREE.Mesh(mouthGeo, mouthMat);
		mouth.position.set(0, -0.2, -0.7); // Flipped Z to negative
		mouth.rotation.x = Math.PI / 2; // Rotate to be flat
		mouth.rotation.z = Math.PI;
		this.dollHead.add(mouth);

		this.doll.position.set(0, -0.1, DOLL_POSITION_Z); // Set base near ground plane
		this.dollTargetRotationY = 0; // Initially facing away
		this.dollHead.rotation.y = this.dollTargetRotationY;
		this.doll.scale.set(DOLL_SCALE, DOLL_SCALE, DOLL_SCALE); // Scale the entire doll
		this.scene.add(this.doll);

		// Lighting
		const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
		this.scene.add(ambientLight);

		const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
		directionalLight.position.set(15, 30, 20);
		directionalLight.castShadow = true;
		directionalLight.shadow.mapSize.width = 2048; // Increased resolution
		directionalLight.shadow.mapSize.height = 2048;
		directionalLight.shadow.camera.near = 0.5;
		directionalLight.shadow.camera.far = 200; // Increased far plane
		directionalLight.shadow.camera.left = -FIELD_WIDTH * 1.5; // Adjusted bounds
		directionalLight.shadow.camera.right = FIELD_WIDTH * 1.5;
		directionalLight.shadow.camera.top = FIELD_LENGTH;
		directionalLight.shadow.camera.bottom = -FIELD_LENGTH;
		this.scene.add(directionalLight);

		// Enable Shadows in Renderer
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

		// Pre-create particle geometry/material for efficiency
		this.particleGeometry = new THREE.BoxGeometry(0.15, 0.15, 0.15); // Small cubes
		this.particleMaterial = new THREE.MeshStandardMaterial({
			color: 0xff0000, // Blood red
			roughness: 0.8,
		});
	}

	private createExitButton(): void {
		this.exitButtonElement = document.createElement("button");
		this.exitButtonElement.textContent = "Exit Game";
		this.exitButtonElement.style.position = "absolute";
		this.exitButtonElement.style.top = "20px";
		this.exitButtonElement.style.left = "20px";
		this.exitButtonElement.style.padding = "10px 15px";
		this.exitButtonElement.style.backgroundColor = "#ff4d4d";
		this.exitButtonElement.style.color = "white";
		this.exitButtonElement.style.border = "none";
		this.exitButtonElement.style.borderRadius = "5px";
		this.exitButtonElement.style.cursor = "pointer";
		this.exitButtonElement.style.zIndex = "1000"; // Ensure it's on top
		this.exitButtonElement.addEventListener("click", () =>
			this.onExitCallback(this.gameOutcome),
		);
		document.body.appendChild(this.exitButtonElement);
	}

	// --- Event Listeners ---

	private setupEventListeners(): void {
		window.addEventListener("resize", this.onWindowResize.bind(this));
		document.addEventListener("keydown", this.onKeyDown.bind(this));
		document.addEventListener("keyup", this.onKeyUp.bind(this));
	}

	private onWindowResize(): void {
		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(window.innerWidth, window.innerHeight);
	}

	private onKeyDown(event: KeyboardEvent): void {
		const key = event.key.toLowerCase();
		this.keysPressed[key] = true;

		if (key === "w" || key === "arrowup") {
			this.isMovingForwardInput = true;
			if (this.gameState === GameState.READY) {
				this._startGameSequence();
			}
		}
	}

	private onKeyUp(event: KeyboardEvent): void {
		const key = event.key.toLowerCase();
		this.keysPressed[key] = false;
		if (key === "w" || key === "arrowup") {
			this.isMovingForwardInput = false; // Clear input flag
		}
	}

	// --- Game Logic ---

	private _startGameSequence(): void {
		if (this.gameState !== GameState.READY) {
			return;
		}
		console.log("Starting game sequence...");
		this.gameState = GameState.GREEN_LIGHT;
		// Start with the green light phase (doll facing away)
		this.currentLightTimer = DOLL_SOUND_DURATION - DOLL_TURN_DURATION; // Time facing away
		this.dollTargetRotationY = 0; // Face away initially
		this.dollHead.rotation.y = this.dollTargetRotationY; // Snap rotation
		this.dollHead.quaternion.setFromEuler(
			new THREE.Euler(0, this.dollTargetRotationY, 0),
		); // Ensure quaternion matches
		this.gameTimer = GAME_TIME_LIMIT; // Ensure timer resets
		this.playerVelocity.set(0, 0, 0);
		this.respawnTimer = 0;
		console.log("Green Light!");
		this.playDollSound(); // Start sound on Green Light
	}

	private resetGame(): void {
		this.player.position.copy(this.playerStartPosition);
		this.playerVelocity.set(0, 0, 0);
		this.player.visible = true; // Ensure player is visible
		this.isMovingForwardInput = false;
		this.keysPressed = {};
		this.gameTimer = GAME_TIME_LIMIT;
		this.gameState = GameState.READY;
		this.dollTargetRotationY = 0;
		this.dollHead.rotation.y = this.dollTargetRotationY; // Snap rotation
		this.dollHead.quaternion.setFromEuler(
			new THREE.Euler(0, this.dollTargetRotationY, 0),
		); // Ensure quaternion matches
		this.redLightStartPosition.copy(this.player.position);
		this.respawnTimer = 0; // Reset respawn timer
		this.winTimer = 3; // Reset win timer
		this.gameOverReason = ""; // Clear reason
		this.gameOverPosition.copy(this.playerStartPosition); // Reset game over position

		// Removed difficulty duration resets

		// Stop sound
		this.stopDollSound();

		// Remove explosion particles
		for (const p of this.explosionParticles) {
			this.scene.remove(p.mesh);
			if (p.mesh.material instanceof THREE.Material) {
				p.mesh.material.dispose();
			}
		}
		this.explosionParticles = [];

		this.updateCamera(true); // Force snap camera to initial position
		this.updateStatusHTML(0); // Update HTML status display
		console.log("Game Reset.");
	}

	private playDollSound(): void {
		// Play sound from the beginning if available and not already playing
		if (this.dollSound && !this.dollSound.isPlaying && !this.isMuted) {
			console.log("Playing doll sound");
			this.dollSound.stop(); // Ensure it plays from start if previously paused/stopped
			this.dollSound.play();
		} else if (this.isMuted) {
			console.log("Doll sound not played (muted)");
		}
	}

	private stopDollSound(): void {
		// Use optional chaining to satisfy linter
		if (this.dollSound?.isPlaying) {
			console.log("Stopping doll sound");
			this.dollSound.stop();
		}
	}

	private update(deltaTime: number): void {
		// Update HTML status display
		this.updateStatusHTML(deltaTime);

		// Apply Movement Physics
		if (
			this.gameState !== GameState.GAME_OVER &&
			this.gameState !== GameState.WIN &&
			this.gameState !== GameState.READY
		) {
			this.handlePlayerMovement(deltaTime);
		} else if (this.gameState === GameState.READY) {
			this.playerVelocity.set(0, 0, 0);
		}

		// Update Explosion Particles
		this.updateExplosion(deltaTime);

		// Update Camera
		this.updateCamera();

		// --- Game Logic ---
		const activeGameStates = [
			GameState.GREEN_LIGHT,
			GameState.RED_LIGHT_TRANSITION_TO_RED,
			GameState.RED_LIGHT_WATCHING,
			GameState.RED_LIGHT_TRANSITION_TO_GREEN,
		];

		if (activeGameStates.includes(this.gameState)) {
			// Update Game Timer
			this.gameTimer -= deltaTime;
			if (this.gameTimer <= 0) {
				this.gameOver("Time's up!", this.player.position);
				return;
			}

			// State Machine Logic
			switch (this.gameState) {
				case GameState.GREEN_LIGHT:
					// Sound should be playing here (started in GREEN_LIGHT or RED_LIGHT_TRANSITION_TO_GREEN)
					// this.playDollSound(); // Not needed, sound continues
					this.currentLightTimer -= deltaTime;
					if (this.currentLightTimer <= 0) {
						console.log(
							"[State Change] GREEN_LIGHT -> RED_LIGHT_TRANSITION_TO_RED",
						);
						// Sound continues playing during turn
						this.gameState = GameState.RED_LIGHT_TRANSITION_TO_RED;
						this.currentLightTimer = DOLL_TURN_DURATION; // Set timer for turning phase
						this.dollTargetRotationY = Math.PI;
					}
					break;

				case GameState.RED_LIGHT_TRANSITION_TO_RED: {
					// Sound should be playing here
					this.rotateDollHead(deltaTime);
					this.currentLightTimer -= deltaTime; // Timer for the turn itself

					if (this.currentLightTimer <= 0) {
						// Ensure rotation is finished before changing state
						this.dollHead.rotation.y = this.dollTargetRotationY;
						this.dollHead.quaternion.setFromEuler(
							new THREE.Euler(0, this.dollTargetRotationY, 0),
						);

						console.log(
							"[State Change] RED_LIGHT_TRANSITION_TO_RED -> RED_LIGHT_WATCHING",
						);
						this.stopDollSound(); // Stop sound EXACTLY when facing player
						this.gameState = GameState.RED_LIGHT_WATCHING;
						this.currentLightTimer = RED_LIGHT_WATCH_DURATION; // Set fixed watch timer
						this.redLightStartPosition.copy(this.player.position);
						console.log(
							` -- Red Light Watching Start Position: Z=${this.redLightStartPosition.z.toFixed(3)}`,
						);
					}
					break;
				}

				case GameState.RED_LIGHT_WATCHING:
					// Sound should be stopped here
					// this.stopDollSound(); // Already stopped on transition
					this.checkForMovementViolation();
					if (this.gameState !== GameState.RED_LIGHT_WATCHING) break; // Exit if game over triggered

					this.currentLightTimer -= deltaTime;
					if (this.currentLightTimer <= 0) {
						console.log(
							"[State Change] RED_LIGHT_WATCHING -> RED_LIGHT_TRANSITION_TO_GREEN",
						);
						this.gameState = GameState.RED_LIGHT_TRANSITION_TO_GREEN;
						this.currentLightTimer = DOLL_TURN_DURATION; // Set timer for turning back
						this.dollTargetRotationY = 0;
						this.playDollSound(); // Start sound as doll turns away
						// Removed decreaseDurations();
					}
					break;

				case GameState.RED_LIGHT_TRANSITION_TO_GREEN: {
					// Sound should be playing here
					this.rotateDollHead(deltaTime);
					this.currentLightTimer -= deltaTime; // Timer for the turn itself

					if (this.currentLightTimer <= 0) {
						// Wrap variable declaration in block scope for linter
						// Ensure rotation is finished
						this.dollHead.rotation.y = this.dollTargetRotationY;
						this.dollHead.quaternion.setFromEuler(
							new THREE.Euler(0, this.dollTargetRotationY, 0),
						);
						console.log(
							"[State Change] RED_LIGHT_TRANSITION_TO_GREEN -> GREEN_LIGHT",
						);
						this.gameState = GameState.GREEN_LIGHT;
						this.currentLightTimer = DOLL_SOUND_DURATION - DOLL_TURN_DURATION; // Set timer for facing away phase
						// Sound continues playing
					}
					break;
				}
			}

			// Check win condition only if still in an active state
			if (activeGameStates.includes(this.gameState)) {
				this.checkWinCondition();
			}
		}
	}

	private handlePlayerMovement(deltaTime: number): void {
		// ... (previous movement logic remains unchanged) ...
		const targetVelocityZ = this.isMovingForwardInput ? -PLAYER_MOVE_SPEED : 0;
		const currentVelocityZ = this.playerVelocity.z;
		let acceleration = 0;

		if (targetVelocityZ < currentVelocityZ) {
			acceleration = -PLAYER_ACCELERATION;
		} else if (targetVelocityZ > currentVelocityZ) {
			acceleration = PLAYER_DECELERATION;
		}

		let newVelocityZ = currentVelocityZ + acceleration * deltaTime;

		if (targetVelocityZ < 0) {
			newVelocityZ = Math.max(newVelocityZ, targetVelocityZ);
		} else {
			newVelocityZ = Math.min(newVelocityZ, targetVelocityZ);
		}

		this.playerVelocity.z = newVelocityZ;

		if (Math.abs(this.playerVelocity.z) > 1e-3) {
			const moveDistance = this.playerVelocity.z * deltaTime;
			this.player.position.z += moveDistance;

			// Keep the upper bound clamp (start line side)
			this.player.position.z = Math.min(
				this.player.position.z,
				PLAYER_START_Z + 2,
			);

			const halfWidth = FIELD_WIDTH / 2 - 0.5;
			this.player.position.x = Math.max(
				-halfWidth,
				Math.min(halfWidth, this.player.position.x),
			);
		}
	}

	private updateCamera(snap = false): void {
		// ... (previous camera logic remains unchanged) ...
		if (!this.player) return;

		let targetPosition: THREE.Vector3;

		if (this.gameState === GameState.GAME_OVER) {
			targetPosition = this.gameOverPosition;
		} else if (this.gameState === GameState.READY) {
			targetPosition = this.playerStartPosition;
		} else {
			targetPosition = this.player.position;
		}

		const desiredPosition = targetPosition.clone().add(CAMERA_OFFSET);
		const lookAtTarget = targetPosition.clone();
		lookAtTarget.z -= 15;
		lookAtTarget.y += 4.0;

		if (snap) {
			this.camera.position.copy(desiredPosition);
		} else {
			this.camera.position.lerp(desiredPosition, 0.05);
		}
		this.camera.lookAt(lookAtTarget);
	}

	private checkForMovementViolation(): void {
		// ... (previous check logic remains unchanged) ...
		const distSq = this.player.position.distanceToSquared(
			this.redLightStartPosition,
		);
		const posChanged =
			distSq > MOVEMENT_DETECTION_THRESHOLD * MOVEMENT_DETECTION_THRESHOLD;
		const isActuallyMoving = Math.abs(this.playerVelocity.z) > 0.01;

		// console.log(
		// 	`[Check Move] Pos Changed: ${posChanged} (DistSq: ${distSq.toFixed(4)} > ThresholdSq: ${(MOVEMENT_DETECTION_THRESHOLD * MOVEMENT_DETECTION_THRESHOLD).toFixed(4)}), Moving: ${isActuallyMoving} (Vel Z: ${this.playerVelocity.z.toFixed(4)})`,
		// );

		if (posChanged || isActuallyMoving) {
			console.log(
				`Movement violation detected. Pos Changed: ${posChanged}, Moving: ${isActuallyMoving}, Vel Z: ${this.playerVelocity.z}`,
			);
			this.gameOver("Moved during Red Light!", this.player.position);
		}
	}

	private rotateDollHead(deltaTime: number): void {
		// Rotate using slerp towards the target rotation
		const targetRotationY = this.dollTargetRotationY;
		const currentQuat = this.dollHead.quaternion.clone();
		const targetQuat = new THREE.Quaternion().setFromEuler(
			new THREE.Euler(0, targetRotationY, 0),
		);

		// Calculate step based on fixed speed
		const step = REQUIRED_DOLL_TURN_SPEED * deltaTime;
		currentQuat.rotateTowards(targetQuat, step); // Use rotateTowards for constant speed
		this.dollHead.quaternion.copy(currentQuat);

		// No need to check angle explicitly if transitions are timer-based
		// The timer ensures the state changes after DOLL_TURN_DURATION
	}

	private checkWinCondition(): void {
		if (this.player.position.z <= FINISH_LINE_Z) {
			this.winGame();
		}
	}

	private winGame(): void {
		if (
			this.gameState !== GameState.WIN &&
			this.gameState !== GameState.GAME_OVER
		) {
			console.log("You Win!");
			this.stopDollSound(); // Stop sound on win
			this.gameState = GameState.WIN;
			// Reset doll rotation immediately and explicitly on win
			this.dollTargetRotationY = 0;
			this.dollHead.rotation.y = 0;
			this.dollHead.quaternion.setFromEuler(new THREE.Euler(0, 0, 0));
			this.winTimer = 3; // Reset win timer to 3 seconds

			// --- Trigger Confetti ---
			this.triggerWinConfetti();
			this.gameOutcome = "passed"; // Set outcome to passed
		}
	}

	// Helper function for confetti effect
	private triggerWinConfetti(): void {
		// Launch from left
		confetti({
			particleCount: 100,
			angle: 60,
			spread: 80,
			origin: { x: 0, y: 1 }, // Start from bottom-left
			scalar: 1.2, // Slightly larger confetti
			ticks: 300, // Last a bit longer
			gravity: 0.8,
		});
		// Launch from right
		confetti({
			particleCount: 100,
			angle: 120,
			spread: 80,
			origin: { x: 1, y: 1 }, // Start from bottom-right
			scalar: 1.2,
			ticks: 300,
			gravity: 0.8,
		});
		// Maybe a central burst too
		confetti({
			particleCount: 150,
			angle: 90,
			spread: 100,
			origin: { y: 0.7 }, // Start slightly lower middle
			scalar: 1.5,
			ticks: 400,
			gravity: 0.9,
		});
	}

	private gameOver(reason: string, position: THREE.Vector3): void {
		const activeGameStates = [
			GameState.GREEN_LIGHT,
			GameState.RED_LIGHT_TRANSITION_TO_RED,
			GameState.RED_LIGHT_WATCHING,
			GameState.RED_LIGHT_TRANSITION_TO_GREEN,
		];
		if (activeGameStates.includes(this.gameState)) {
			console.log(`Game Over! ${reason}`);
			this.stopDollSound(); // Stop sound on game over
			this.gameState = GameState.GAME_OVER;
			this.gameOverReason = reason;
			this.respawnTimer = RESPAWN_DELAY;
			this.player.visible = false;
			this.playerVelocity.set(0, 0, 0);
			this.gameOverPosition.copy(position);
			this.gameOutcome = "failed"; // Set outcome to failed
			// Reset doll rotation immediately and explicitly on game over
			this.dollTargetRotationY = 0;
			this.dollHead.rotation.y = 0;
			this.dollHead.quaternion.setFromEuler(new THREE.Euler(0, 0, 0)); // Explicitly set quaternion
			this.createExplosion(position);
		}
	}

	private createExplosion(position: THREE.Vector3): void {
		// ... (previous explosion code remains unchanged) ...
		if (!this.particleGeometry || !this.particleMaterial) return;

		for (let i = 0; i < EXPLOSION_PARTICLE_COUNT; i++) {
			const mesh = new THREE.Mesh(
				this.particleGeometry,
				this.particleMaterial.clone(),
			);
			mesh.position.copy(position).add(new THREE.Vector3(0, 0.5, 0));
			mesh.castShadow = true;

			const velocity = new THREE.Vector3(
				(Math.random() - 0.5) * 2,
				(Math.random() - 0.5) * 2 + Math.random() * 0.5,
				(Math.random() - 0.5) * 2,
			);
			velocity
				.normalize()
				.multiplyScalar(EXPLOSION_PARTICLE_SPEED * (0.5 + Math.random() * 0.5));

			this.explosionParticles.push({
				mesh,
				velocity,
				life: EXPLOSION_PARTICLE_LIFETIME,
			});
			this.scene.add(mesh);
		}
	}

	private updateExplosion(deltaTime: number): void {
		// ... (previous explosion update code remains unchanged) ...
		const particlesToRemove: ExplosionParticle[] = [];
		for (const p of this.explosionParticles) {
			p.life -= deltaTime;

			if (p.life <= 0) {
				particlesToRemove.push(p);
				this.scene.remove(p.mesh);
				if (p.mesh.material instanceof THREE.Material) {
					p.mesh.material.dispose();
				}
			} else {
				p.velocity.y += GRAVITY * deltaTime;
				p.mesh.position.addScaledVector(p.velocity, deltaTime);

				// Check if material is MeshStandardMaterial before accessing opacity
				if (p.mesh.material instanceof THREE.MeshStandardMaterial) {
					// Ensure material is transparent for opacity to work
					if (!p.mesh.material.transparent) {
						p.mesh.material.transparent = true;
					}
					p.mesh.material.opacity = Math.max(
						0,
						p.life / EXPLOSION_PARTICLE_LIFETIME,
					);
				}

				if (p.mesh.position.y < -0.1) {
					p.mesh.position.y = -0.1;
					p.velocity.y *= -0.3;
					p.velocity.x *= 0.8;
					p.velocity.z *= 0.8;
				}
			}
		}

		this.explosionParticles = this.explosionParticles.filter(
			(p) => !particlesToRemove.includes(p),
		);
	}

	private updateStatusHTML(deltaTime: number): void {
		// ... (previous status update logic remains unchanged) ...
		if (!this.statusElementHTML) return;

		let statusText = "";
		let display = "block";

		switch (this.gameState) {
			case GameState.READY:
				statusText = "Press 'W' to Move";
				break;
			case GameState.GREEN_LIGHT:
			case GameState.RED_LIGHT_TRANSITION_TO_RED:
			case GameState.RED_LIGHT_WATCHING:
			case GameState.RED_LIGHT_TRANSITION_TO_GREEN:
				display = "none";
				break;
			case GameState.GAME_OVER:
				this.respawnTimer -= deltaTime;
				if (this.respawnTimer > 0) {
					statusText = `GAME OVER! ${this.gameOverReason}\nRespawning in ${Math.ceil(this.respawnTimer)}...`;
				} else {
					this.resetGame();
					return;
				}
				break;
			case GameState.WIN:
				this.winTimer -= deltaTime;
				if (this.winTimer > 0) {
					statusText = `YOU WIN!\nReturning to menu in ${Math.ceil(this.winTimer)}...`;
				} else {
					// Return to main menu after the timer expires
					this.onExitCallback(this.gameOutcome);
					return;
				}
				break;
		}

		this.statusElementHTML.textContent = statusText;
		this.statusElementHTML.style.display = display;
	}

	// --- Public Methods ---

	public animate(): void {
		const deltaTime = this.clock.getDelta();
		this.update(deltaTime);
		this.renderer.render(this.scene, this.camera);
	}

	public dispose(): void {
		window.removeEventListener("resize", this.onWindowResize);
		document.removeEventListener("keydown", this.onKeyDown);
		document.removeEventListener("keyup", this.onKeyUp);

		// Remove the exit button
		if (this.exitButtonElement) {
			this.exitButtonElement.remove();
			this.exitButtonElement = null;
		}

		// Stop doll sound
		this.stopDollSound();

		// *** DO NOT remove the listener from the camera here ***
		// The listener belongs to the main SquidGame instance
		// if (this.camera && this.audioListener) {
		// 	this.camera.remove(this.audioListener);
		// }

		this.scene.traverse((object) => {
			if (object instanceof THREE.Mesh) {
				object.geometry?.dispose();
				const material = object.material;
				if (Array.isArray(material)) {
					for (const mat of material) {
						mat.dispose();
					}
				} else if (material) {
					material.dispose();
				}
			}
		});

		this.particleGeometry?.dispose();
		this.particleMaterial?.dispose();
		this.explosionParticles = [];
		this.dollSoundBuffer = null; // Clear buffer reference

		console.log("Game resources disposed.");
	}

	public setMuted(muted: boolean): void {
		this.isMuted = muted;

		// Update doll sound volume if exists
		if (this.dollSound) {
			this.dollSound.setVolume(this.isMuted ? 0 : 0.5);

			// Stop sound if newly muted and currently playing
			if (this.isMuted && this.dollSound.isPlaying) {
				this.dollSound.stop();
			}
		}

		console.log(`Game sounds ${this.isMuted ? "muted" : "unmuted"}`);
	}
}
