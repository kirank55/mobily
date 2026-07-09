import { View, Text, StyleSheet } from 'react-native';

export default function TerminalRoute() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Terminal — arrives in branch 4</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 16,
    color: '#ccc',
  },
});
