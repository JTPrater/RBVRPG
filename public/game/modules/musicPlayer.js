(function (RBV) {
  const setSfxVolume =
    RBV.audio?.setSfxVolume ||
    function () {
    };

  const musicPlayer = {
    songs: [],
    currentSongIndex: 0,
    audio: new Audio(),
    isPlaying: false,
    isShuffleOn: false,
    isRepeatOn: false,
    originalPlaylist: [],

    init() {
      const songSelect = document.getElementById("song-select");

      try {
        fetch("/api/get-songs")
          .then((response) => {
            if (!response.ok)
              throw new Error(`HTTP error! status: ${response.status}`);
            return response.json();
          })
          .then((songs) => {
            if (Array.isArray(songs)) {
              this.songs = songs;

              songSelect.innerHTML =
                '<option value="">Select a song...</option>';
              songs.forEach((song, index) => {
                const songName = song.split("/").pop().replace(".mp3", "");
                const option = document.createElement("option");
                option.value = index;
                option.textContent = songName;
                songSelect.appendChild(option);
              });

              if (this.songs.length > 0) {
                this.currentSongIndex = Math.floor(
                  Math.random() * this.songs.length,
                );
                this.loadCurrentSong();
                songSelect.value = this.currentSongIndex;
              }
            }
          })
          .catch((error) => {
            console.error("Error loading songs:", error);
            document.getElementById("current-song").textContent =
              "Error loading music";
          });

        songSelect.addEventListener("change", (e) => {
          const selectedIndex = parseInt(e.target.value, 10);
          if (!isNaN(selectedIndex)) {
            this.currentSongIndex = selectedIndex;
            this.loadCurrentSong();
            if (this.isPlaying) {
              this.audio.play().catch(() => {});
            }
          }
        });

        this.audio.addEventListener("ended", () => {
          this.playNext();
          songSelect.value = this.currentSongIndex;
        });

        document.getElementById("play-pause").addEventListener("click", () => {
          this.togglePlay();
        });
        document.getElementById("next-track").addEventListener("click", () => {
          this.playNext();
        });
        document.getElementById("prev-track").addEventListener("click", () => {
          this.playPrev();
        });
        document.getElementById("mute-toggle").addEventListener("click", () => {
          this.toggleMute();
        });
        document
          .getElementById("volume-slider")
          .addEventListener("input", (e) => {
            this.setVolume(e.target.value);
          });
        document.getElementById("sfx-slider").addEventListener("input", (e) => {
          setSfxVolume(e.target.value);
        });
        document
          .getElementById("shuffle")
          .addEventListener("click", () => this.toggleShuffle());
        document
          .getElementById("repeat")
          .addEventListener("click", () => this.toggleRepeat());
      } catch (error) {
        console.error("Failed to initialize music player:", error);
      }
    },

    loadCurrentSong() {
      this.audio.src = this.songs[this.currentSongIndex];
      this.updateNowPlaying();
      if (this.isPlaying) {
        this.audio.play().catch((error) => {
          console.error("Error playing song:", error);
        });
      }
    },

    togglePlay() {
      if (this.audio.paused) {
        this.audio
          .play()
          .then(() => {
            this.isPlaying = true;
          })
          .catch((error) => {
            console.error("Error playing music:", error);
          });
      } else {
        this.audio.pause();
        this.isPlaying = false;
      }
      this.updatePlayButton();
    },

    playNext() {
      if (this.songs.length === 0) return;

      if (this.isRepeatOn) {
        this.loadCurrentSong();
        if (this.isPlaying) this.audio.play().catch(() => {});
        return;
      }

      this.currentSongIndex = (this.currentSongIndex + 1) % this.songs.length;
      this.loadCurrentSong();
      if (this.isPlaying) this.audio.play().catch(() => {});
    },

    playPrev() {
      if (this.songs.length === 0) return;
      this.currentSongIndex =
        (this.currentSongIndex - 1 + this.songs.length) % this.songs.length;
      this.loadCurrentSong();
    },

    toggleMute() {
      this.audio.muted = !this.audio.muted;
      const icon = this.audio.muted ? "volume_off" : "volume_up";
      document.querySelector("#mute-toggle .material-icons").textContent = icon;
    },

    setVolume(value) {
      this.audio.volume = value / 100;
    },

    updateNowPlaying() {
      if (this.songs.length === 0) {
        document.getElementById("current-song").textContent =
          "No songs available";
        return;
      }
      const songName = this.songs[this.currentSongIndex]
        .split("/")
        .pop()
        .replace(".mp3", "");
      document.getElementById("current-song").textContent =
        `Now Playing: ${songName}`;
    },

    updatePlayButton() {
      const icon = this.isPlaying ? "pause" : "play_arrow";
      document.querySelector("#play-pause .material-icons").textContent = icon;
    },

    toggleShuffle() {
      this.isShuffleOn = !this.isShuffleOn;
      const shuffleBtn = document.getElementById("shuffle");

      if (this.isShuffleOn) {
        shuffleBtn.classList.add("active");
        this.originalPlaylist = [...this.songs];
        this.songs = this.shuffleArray([...this.songs]);
      } else {
        shuffleBtn.classList.remove("active");
        if (this.originalPlaylist.length) {
          this.songs = [...this.originalPlaylist];
        }
      }
    },

    toggleRepeat() {
      this.isRepeatOn = !this.isRepeatOn;
      const repeatBtn = document.getElementById("repeat");
      if (this.isRepeatOn) {
        repeatBtn.classList.add("active");
      } else {
        repeatBtn.classList.remove("active");
      }
    },

    shuffleArray(array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    },

    fadeTo(targetVolume, duration = 2000) {
      return new Promise((resolve) => {
        if (this._fadeInterval) clearInterval(this._fadeInterval);
        const startVolume = this.audio.volume;
        const steps = 30;
        const stepTime = duration / steps;
        const volumeStep = (targetVolume - startVolume) / steps;
        let currentStep = 0;

        this._fadeInterval = setInterval(() => {
          currentStep++;
          if (currentStep >= steps) {
            this.audio.volume = targetVolume;
            clearInterval(this._fadeInterval);
            this._fadeInterval = null;
            resolve();
          } else {
            this.audio.volume = Math.max(
              0,
              Math.min(1, startVolume + volumeStep * currentStep),
            );
          }
        }, stepTime);
      });
    },

    async playEventMusic(
      src,
      {
        fallbackSrc = null,
        volume = 0.5,
        fadeOutMs = 2000,
        fadeInMs = 3000,
      } = {},
    ) {
      const savedVolume = this.audio.volume;
      const wasPlaying = this.isPlaying && !this.audio.paused;

      if (wasPlaying) {
        await this.fadeTo(0, fadeOutMs);
        this.audio.pause();
      }

      const eventAudio = new Audio(src);
      eventAudio.volume = volume;

      const tryPlay = (audioSrc) =>
        new Promise((resolve) => {
          eventAudio.src = audioSrc;
          eventAudio.addEventListener("ended", resolve, { once: true });
          eventAudio.play().catch(() => resolve());
        });

      try {
        await tryPlay(src);
      } catch {
        if (fallbackSrc) await tryPlay(fallbackSrc);
      }

      if (wasPlaying) {
        this.audio.volume = 0;
        this.audio.play().catch(() => {});
        await this.fadeTo(savedVolume, fadeInMs);
      }
    },
  };

  RBV.music = { player: musicPlayer };
  window.musicPlayer = musicPlayer;
})(window.RBV);
