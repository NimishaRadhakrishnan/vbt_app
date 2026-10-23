import React, { useState } from 'react';
import { StyleProp, TextInput, TextInputProps, TextStyle, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color } from '../theme';

// A password box with an eye button to show what was typed. Hidden by default.
export default function PasswordField({ style, ...rest }: Omit<TextInputProps, 'secureTextEntry' | 'style'> & { style?: StyleProp<TextStyle> }) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={{ justifyContent: 'center' }}>
      <TextInput
        {...rest}
        style={[style, { paddingRight: 44 }]}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TouchableOpacity
        onPress={() => setVisible((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={color.textMuted} />
      </TouchableOpacity>
    </View>
  );
}
