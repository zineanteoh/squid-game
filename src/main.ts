import * as THREE from "three";
import "./style.css";
import { RedLightGreenLightGame } from "./scenes/RedLightGreenLight";

class SquidGame {
	private scene: THREE.Scene;
	private camera: THREE.PerspectiveCamera;
	private renderer: THREE.WebGLRenderer;
	private games: {
		title: string;
		available: boolean;
		status: "not_started" | "passed" | "failed";
	}[];
	private currentGame: RedLightGreenLightGame | null = null;
	private listener: THREE.AudioListener;
	private backgroundSound: THREE.Audio | null = null;
	private isMusicPlaying = false;
	private isMuted = false;
	private mainMenuClickListener: (() => void) | null = null;

	constructor() {
		// Initialize Three.js scene
		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(
			75,
			window.innerWidth / window.innerHeight,
			0.1,
			1000,
		);
		this.renderer = new THREE.WebGLRenderer({ antialias: true });
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		document.body.appendChild(this.renderer.domElement);

		// Audio Listener
		this.listener = new THREE.AudioListener();
		this.camera.add(this.listener);

		// Define games
		this.games = [
			{
				title: "Red Light, Green Light",
				available: true,
				status: "not_started",
			},
			{ title: "Honeycomb", available: false, status: "not_started" },
			{ title: "Tug of War", available: false, status: "not_started" },
			{ title: "Marbles", available: false, status: "not_started" },
			{ title: "Glass Bridge", available: false, status: "not_started" },
			{ title: "Squid Game", available: false, status: "not_started" },
		];

		// Setup
		this.setupScene();
		this.createMainMenu();
		this.animate();

		// Handle window resize
		window.addEventListener("resize", () => this.onWindowResize());
	}

	private setupScene(): void {
		this.scene.background = new THREE.Color(0x1a1a1a);
		this.camera.position.z = 5;
	}

	private loadBackgroundMusic(): void {
		// Stop any existing background sound first
		if (this.backgroundSound) {
			if (this.backgroundSound.isPlaying) {
				this.backgroundSound.stop();
			}
			// Instead of setting buffer to null, just create a new audio object
			this.backgroundSound.disconnect();
			console.log("Stopped existing background sound");
		}

		const audioLoader = new THREE.AudioLoader();
		audioLoader.load(
			"/background.mp3",
			(buffer) => {
				// Always create a new audio instance to avoid issues
				this.backgroundSound = new THREE.Audio(this.listener);
				this.backgroundSound.setBuffer(buffer);
				this.backgroundSound.setLoop(true);

				// Set volume based on mute state
				const volume = this.isMuted ? 0 : 0.5;
				this.backgroundSound.setVolume(volume);

				console.log("Background music loaded, waiting for user interaction.");
			},
			undefined, // onProgress callback (optional)
			(err) => {
				console.error("Error loading background music:", err);
			},
		);
	}

	// Helper to attempt starting music playback once
	private attemptFirstPlay(): void {
		if (this.backgroundSound && !this.isMusicPlaying) {
			try {
				// Resume audio context if suspended (required by browsers)
				const context = this.listener.context;
				if (context.state === "suspended") {
					context.resume();
				}

				// Only play if not already playing
				if (!this.backgroundSound.isPlaying) {
					this.backgroundSound.play();
					this.isMusicPlaying = true;
					console.log("Background music started by user interaction.");
				}
			} catch (error) {
				console.error("Error trying to play background music:", error);
			}
		}
	}

	// Helper function for the body listener
	private attemptFirstPlayAndRemoveListener(): void {
		this.attemptFirstPlay();
		// Remove the listener after the first interaction
		if (this.mainMenuClickListener) {
			document.body.removeEventListener("click", this.mainMenuClickListener);
			console.log("Body click listener removed.");
			this.mainMenuClickListener = null; // Clear the stored reference
		}
	}

	private createMainMenu(): void {
		// Ensure no existing menu or game elements are present
		const existingMenu = document.querySelector(".menu-container");
		if (existingMenu) existingMenu.remove();
		const existingStatus = document.getElementById("game-status");
		if (existingStatus) existingStatus.remove();
		const existingExitButton = document.querySelector("button"); // Simple selector for the exit button
		if (existingExitButton && existingExitButton.textContent === "Exit Game") {
			existingExitButton.remove();
		}

		// Remove any existing control buttons
		const existingControls = document.getElementById("menu-controls");
		if (existingControls) existingControls.remove();

		// Load music only if it doesn't exist or isn't playing
		if (!this.backgroundSound || !this.isMusicPlaying) {
			this.loadBackgroundMusic();
			this.isMusicPlaying = false; // Reset flag to false until user interacts
		}

		this.mainMenuClickListener = null; // Ensure listener ref is null initially

		// Add listener to body for clicks outside game boxes
		// Store the bound function reference so we can remove it
		this.mainMenuClickListener =
			this.attemptFirstPlayAndRemoveListener.bind(this);
		document.body.addEventListener("click", this.mainMenuClickListener);
		console.log("Body click listener added.");

		// Create control buttons container
		const controlsContainer = document.createElement("div");
		controlsContainer.id = "menu-controls";
		controlsContainer.style.position = "absolute";
		controlsContainer.style.top = "20px";
		controlsContainer.style.right = "20px";
		controlsContainer.style.zIndex = "1000";
		controlsContainer.style.display = "flex";
		controlsContainer.style.gap = "10px";

		// Create reset state button
		const resetButton = document.createElement("button");
		resetButton.textContent = "Reset Progress";
		resetButton.className = "control-button";
		resetButton.addEventListener("click", () => this.resetGameProgress());
		controlsContainer.appendChild(resetButton);

		// Create mute music button
		const muteButton = document.createElement("button");
		muteButton.textContent = this.isMuted ? "Unmute Music" : "Mute Music";
		muteButton.className = "control-button";
		muteButton.addEventListener("click", () => {
			this.toggleMute();
			muteButton.textContent = this.isMuted ? "Unmute Music" : "Mute Music";
		});
		controlsContainer.appendChild(muteButton);

		document.body.appendChild(controlsContainer);

		const menuContainer = document.createElement("div");
		menuContainer.className = "menu-container";

		this.games.forEach((game, index) => {
			const gameBox = document.createElement("div");
			gameBox.className = "game-box";

			const img = document.createElement("img");
			img.src = `/game_${index + 1}.jpg`;
			img.alt = game.title;
			gameBox.appendChild(img);

			const title = document.createElement("h2");
			title.textContent = game.title;

			if (!game.available) {
				gameBox.classList.add("coming-soon");
				const overlay = document.createElement("div");
				overlay.className = "overlay";
				overlay.textContent = "Coming Soon";
				gameBox.appendChild(overlay);
			} else if (game.status === "passed") {
				gameBox.classList.add("passed");
				const statusOverlay = document.createElement("div");
				statusOverlay.className = "status-overlay";
				statusOverlay.textContent = "PASSED";
				gameBox.appendChild(statusOverlay);
			} else if (game.status === "failed") {
				gameBox.classList.add("failed");
				const statusOverlay = document.createElement("div");
				statusOverlay.className = "status-overlay";
				statusOverlay.textContent = "FAILED";
				gameBox.appendChild(statusOverlay);
			}

			gameBox.appendChild(title);
			menuContainer.appendChild(gameBox);

			if (game.available) {
				gameBox.addEventListener("click", (event) => {
					event.stopPropagation();
					console.log(`Game box "${game.title}" clicked.`);
					this.attemptFirstPlay();
					this.startGame(index);
				});
			}
		});

		document.body.appendChild(menuContainer);
	}

	private startGame(index: number): void {
		// Remove the main menu body interaction listener if it exists
		if (this.mainMenuClickListener) {
			document.body.removeEventListener("click", this.mainMenuClickListener);
			console.log("Body click listener removed by startGame.");
			this.mainMenuClickListener = null;
		}

		// Remove menu container
		const menuContainer = document.querySelector(".menu-container");
		if (menuContainer) {
			menuContainer.remove();
		}

		// Create the specific status element needed by the game
		const gameStatusElement = document.createElement("div");
		gameStatusElement.id = "game-status";
		document.body.appendChild(gameStatusElement);

		if (index === 0) {
			// Pass the shared listener and mute state
			this.currentGame = new RedLightGreenLightGame(
				this.renderer,
				gameStatusElement,
				(result) => this.handleGameEnd(index, result),
				this.listener, // Pass the shared listener
				this.isMuted, // Pass the mute state
			);
		} else {
			gameStatusElement.remove();
			console.log("Selected game is not implemented yet.");
		}
	}

	private handleGameEnd(
		gameIndex: number,
		result: "passed" | "failed" | "exited",
	): void {
		console.log(`Game ${gameIndex} ended with result: ${result}`);

		// Only update game status if the game was actually completed
		if (result === "passed" || result === "failed") {
			this.games[gameIndex].status = result;
		}

		this.returnToMainMenu();
	}

	private returnToMainMenu(): void {
		console.log("Returning to main menu...");

		// Remove the main menu body interaction listener if it somehow persisted
		if (this.mainMenuClickListener) {
			document.body.removeEventListener("click", this.mainMenuClickListener);
			console.log("Body click listener removed by returnToMainMenu.");
			this.mainMenuClickListener = null;
		}

		// Don't stop background music, just let it continue playing
		// This prevents audio context issues and multiple instances

		// Dispose of the current game if it exists
		if (this.currentGame) {
			this.currentGame.dispose();
			this.currentGame = null;
		}

		// Remove game-specific UI elements (like status)
		const gameStatusElement = document.getElementById("game-status");
		if (gameStatusElement) {
			gameStatusElement.remove();
		}

		// Recreate the main menu
		this.createMainMenu();
	}

	private onWindowResize(): void {
		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(window.innerWidth, window.innerHeight);
	}

	private animate(): void {
		requestAnimationFrame(() => this.animate());

		if (this.currentGame) {
			this.currentGame.animate();
		} else {
			this.renderer.render(this.scene, this.camera);
		}
	}

	private toggleMute(): void {
		this.isMuted = !this.isMuted;

		if (this.backgroundSound) {
			if (this.isMuted) {
				this.backgroundSound.setVolume(0);
			} else {
				this.backgroundSound.setVolume(0.5); // Reset to default volume
			}
		}

		// Also update the current game's mute state if it exists
		if (this.currentGame) {
			this.currentGame.setMuted(this.isMuted);
		}

		console.log(`Music ${this.isMuted ? "muted" : "unmuted"}`);
	}

	private resetGameProgress(): void {
		// Reset all game statuses to not_started
		for (const game of this.games) {
			game.status = "not_started";
		}

		console.log("Game progress has been reset");

		// Refresh the main menu to reflect changes
		this.createMainMenu();
	}
}

// Initialize the game
new SquidGame();
