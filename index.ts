// App entry. Imports run in order: Expo Router wants `@expo/metro-runtime` first, then the fatal
// error alert goes in before any app module is evaluated, so even an import-time crash is shown.
import '@expo/metro-runtime';
import './src/lib/installFatalErrorAlert';
import 'expo-router/entry';
