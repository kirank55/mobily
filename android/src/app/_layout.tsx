import { Stack } from 'expo-router';
import { StationConnectionProvider } from '@/client/StationConnection';

export default function RootLayout() {
  return (
    <StationConnectionProvider>
      <Stack />
    </StationConnectionProvider>
  );
}
