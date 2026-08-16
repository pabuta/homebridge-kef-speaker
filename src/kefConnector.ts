import type { Logger } from 'homebridge';

export interface SpeakerStatus {
  power: 'powerOn' | 'standby';
  source: string;
  volume: number;
  muted: boolean;
  isPlaying: boolean;
  songInfo?: {
    title?: string;
    artist?: string;
    album?: string;
    coverUrl?: string;
  };
  songLength?: number;
  songProgress?: number;
}

export interface SpeakerChange {
  power?: 'powerOn' | 'standby';
  source?: string;
  volume?: number;
  muted?: boolean;
  isPlaying?: boolean;
  songInfo?: {
    title?: string;
    artist?: string;
    album?: string;
    coverUrl?: string;
  };
  songLength?: number;
  songProgress?: number;
}

export class KefConnector {
  private readonly baseUrl: string;

  constructor(
    private readonly host: string,
    private readonly log: Logger,
  ) {
    this.baseUrl = `http://${host}/api`;
  }

  async powerOn(): Promise<void> {
    await this.setStatus('powerOn');
  }

  async shutdown(): Promise<void> {
    await this.setStatus('standby');
  }

  async getVolume(): Promise<number> {
    const response = await this.apiRequest('getData', {
      path: 'player:volume',
      roles: 'value',
    });
    return response[0]?.i32_ || 0;
  }

  async setVolume(volume: number): Promise<void> {
    await this.apiRequest('setData', {
      path: 'player:volume',
      role: 'value',
      value: { type: 'i32_', i32_: volume },
    }, 'POST');
  }

  async mute(): Promise<void> {
    await this.setVolume(0);
  }

  async unmute(previousVolume: number): Promise<void> {
    await this.setVolume(previousVolume);
  }

  async getSource(): Promise<string> {
    const response = await this.apiRequest('getData', {
      path: 'settings:/kef/play/physicalSource',
      roles: 'value',
    });
    return response[0]?.kefPhysicalSource || 'standby';
  }

  async setSource(source: string): Promise<void> {
    await this.apiRequest('setData', {
      path: 'settings:/kef/play/physicalSource',
      role: 'value',
      value: { type: 'kefPhysicalSource', kefPhysicalSource: source },
    }, 'POST');
  }

  async getStatus(): Promise<'powerOn' | 'standby'> {
    const response = await this.apiRequest('getData', {
      path: 'settings:/kef/host/speakerStatus',
      roles: 'value',
    });
    return response[0]?.kefSpeakerStatus || 'standby';
  }

  async setStatus(status: 'powerOn' | 'standby'): Promise<void> {
    const source = status === 'powerOn' ? 'wifi' : 'standby';
    await this.setSource(source);
  }

  async togglePlayPause(): Promise<void> {
    await this.trackControl('pause');
  }

  async nextTrack(): Promise<void> {
    await this.trackControl('next');
  }

  async previousTrack(): Promise<void> {
    await this.trackControl('previous');
  }

  private async trackControl(command: string): Promise<void> {
    await this.apiRequest('setData', {
      path: 'player:player/control',
      role: 'activate',
      value: { control: command },
    }, 'POST');
  }

  async getPlayerData(): Promise<any> {
    const response = await this.apiRequest('getData', {
      path: 'player:player/data',
      roles: 'value',
    });
    return response[0] || {};
  }

  async getSongInformation(): Promise<{ title?: string; artist?: string; album?: string; coverUrl?: string }> {
    const playerData = await this.getPlayerData();
    return {
      title: playerData.trackRoles?.title,
      artist: playerData.trackRoles?.mediaData?.metaData?.artist,
      album: playerData.trackRoles?.mediaData?.metaData?.album,
      coverUrl: playerData.trackRoles?.icon,
    };
  }

  async isPlaying(): Promise<boolean> {
    const playerData = await this.getPlayerData();
    return playerData.state === 'playing';
  }

  async getSongLength(): Promise<number | undefined> {
    const playerData = await this.getPlayerData();
    return playerData.status?.duration;
  }

  async getSongProgress(): Promise<number> {
    const response = await this.apiRequest('getData', {
      path: 'player:player/data/playTime',
      roles: 'value',
    });
    return response[0]?.i64_ || 0;
  }

  async getSpeakerName(): Promise<string> {
    const response = await this.apiRequest('getData', {
      path: 'settings:/deviceName',
      roles: 'value',
    });
    return response[0]?.string_ || 'KEF Speaker';
  }

  async getMacAddress(): Promise<string> {
    const response = await this.apiRequest('getData', {
      path: 'settings:/system/primaryMacAddress',
      roles: 'value',
    });
    return response[0]?.string_ || '';
  }

  async getSpeakerModel(): Promise<string> {
    const response = await this.apiRequest('getData', {
      path: 'settings:/releasetext',
      roles: 'value',
    });
    const releaseText = response[0]?.string_ || '';
    return releaseText.split('_')[0] || 'Unknown';
  }

  async getFirmwareVersion(): Promise<string> {
    const response = await this.apiRequest('getData', {
      path: 'settings:/releasetext',
      roles: 'value',
    });
    const releaseText = response[0]?.string_ || '';
    return releaseText.split('_')[1] || 'Unknown';
  }

  async getCompleteStatus(): Promise<SpeakerStatus> {
    const status: SpeakerStatus = {
      power: 'standby',
      source: 'wifi',
      volume: 0,
      muted: false,
      isPlaying: false,
      songInfo: undefined,
    };

    try {
      try { status.power = await this.getStatus(); } catch {}
      try { status.source = await this.getSource(); } catch {}
      try {
        status.volume = await this.getVolume();
        status.muted = status.volume === 0;
      } catch {}
      try { status.isPlaying = await this.isPlaying(); } catch {}
      try { status.songInfo = await this.getSongInformation(); } catch {}
      return status;
    } catch (error) {
      this.log.error('Error getting complete status:', error);
      throw error;
    }
  }

  async checkForChanges(lastStatus: SpeakerStatus): Promise<SpeakerChange> {
    try {
      const currentStatus = await this.getCompleteStatus();
      const changes: SpeakerChange = {};

      if (currentStatus.power !== lastStatus.power) changes.power = currentStatus.power;
      if (currentStatus.source !== lastStatus.source) changes.source = currentStatus.source;
      if (currentStatus.volume !== lastStatus.volume) changes.volume = currentStatus.volume;
      if (currentStatus.muted !== lastStatus.muted) changes.muted = currentStatus.muted;
      if (currentStatus.isPlaying !== lastStatus.isPlaying) changes.isPlaying = currentStatus.isPlaying;

      return changes;
    } catch {
      return {};
    }
  }

  private async apiRequest(endpoint: string, params: any, method = 'GET'): Promise<any> {
    const url = `${this.baseUrl}/${endpoint}`;
    try {
      let response: Response;
      if (method === 'POST') {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
      } else {
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          searchParams.append(key, String(value));
        }
        response = await fetch(`${url}?${searchParams}`);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      this.log.error(`API request failed: ${error}`);
      throw error;
    }
  }
}