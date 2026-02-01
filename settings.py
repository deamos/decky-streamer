import json
import os
from pathlib import Path


class SettingsManager:
    def __init__(self, name: str, settings_directory: str):
        self.name = name
        self.settings_directory = settings_directory
        self.settings_file = os.path.join(settings_directory, f"{name}.json")
        self.settings = {}

    def read(self):
        """Read settings from the JSON file"""
        try:
            if os.path.exists(self.settings_file):
                with open(self.settings_file, 'r') as f:
                    self.settings = json.load(f)
        except Exception as e:
            print(f"Error reading settings: {e}")
            self.settings = {}
        return self.settings

    def write(self):
        """Write settings to the JSON file"""
        try:
            # Ensure directory exists
            Path(self.settings_directory).mkdir(parents=True, exist_ok=True)
            with open(self.settings_file, 'w') as f:
                json.dump(self.settings, f, indent=2)
        except Exception as e:
            print(f"Error writing settings: {e}")

    def getSetting(self, key: str, default=None):
        """Get a setting value by key, returning default if not found"""
        return self.settings.get(key, default)

    def setSetting(self, key: str, value):
        """Set a setting value and save to file"""
        self.settings[key] = value
        self.write()
