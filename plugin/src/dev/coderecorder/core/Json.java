package dev.coderecorder.core;

import java.util.Map;

/** Small writer only: recording never needs to parse untrusted JSON in the IDE. */
public final class Json {
    private Json() {}
    public static String encode(Object value) {
        if (value == null) return "null";
        if (value instanceof Boolean || value instanceof Number) return value.toString();
        if (value instanceof Map) {
            StringBuilder s = new StringBuilder("{");
            ((Map<?, ?>) value).forEach((k, v) -> {
                if (s.length() > 1) s.append(',');
                s.append(encode(k.toString())).append(':').append(encode(v));
            });
            return s.append('}').toString();
        }
        if (value instanceof Iterable) {
            StringBuilder s = new StringBuilder("[");
            for (Object item : (Iterable<?>) value) {
                if (s.length() > 1) s.append(',');
                s.append(encode(item));
            }
            return s.append(']').toString();
        }
        StringBuilder s = new StringBuilder("\"");
        for (char c : value.toString().toCharArray()) {
            switch (c) {
            case '"': s.append("\\\""); break;
            case '\\': s.append("\\\\"); break;
            case '\n': s.append("\\n"); break;
            case '\r': s.append("\\r"); break;
            case '\t': s.append("\\t"); break;
            default:
                // Escape surrogate code units individually, including incomplete IME edits.
                if (c < 32 || Character.isSurrogate(c)) s.append(String.format("\\u%04x", (int) c));
                else s.append(c);
            }
        }
        return s.append('"').toString();
    }
}
