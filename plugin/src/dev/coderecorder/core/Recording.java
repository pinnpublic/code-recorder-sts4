package dev.coderecorder.core;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Ordered changes in UTF-16 offsets. All mutation entry points are serialized. */
public final class Recording {
    private final Map<String, String> contents = new LinkedHashMap<>();
    private final Map<String, String> ids = new LinkedHashMap<>();
    private final ExecutorService writer = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "code-recorder-writer"); t.setDaemon(true); return t;
    });
    private final Path destination;
    private final Path journal;
    private final BufferedWriter stream;
    private final Consumer<Throwable> onFailure;
    private volatile IOException failure;
    private boolean closed;
    private long sequence;
    private long nextId;
    private String active;

    public Recording(Path destination, String root, Map<String, String> initial,
            Map<String, String> encodings, Consumer<Throwable> onFailure) throws IOException {
        this.destination = destination;
        this.onFailure = onFailure;
        journal = destination.resolveSibling(destination.getFileName() + ".journal.jsonl");
        // Never silently replace an earlier lesson or recovery journal.
        if (Files.exists(destination)) throw new IOException("이미 존재하는 녹화 파일입니다: " + destination);
        stream = Files.newBufferedWriter(journal, StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
        List<Object> files = new ArrayList<>();
        initial.forEach((path, text) -> {
            String id = "f" + (++nextId);
            ids.put(path, id); contents.put(path, text);
            files.add(map("fileId", id, "path", path, "text", text,
                    "encoding", encodings.getOrDefault(path, "UTF-8")));
        });
        try {
            stream.write(Json.encode(map("format", "code-recorder", "version", 2,
                    "root", root, "initial", files)));
            stream.newLine(); stream.flush();
        } catch (IOException e) { stream.close(); writer.shutdown(); throw e; }
    }

    public static Map<String, Object> map(Object... pairs) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) m.put((String) pairs[i], pairs[i + 1]);
        return m;
    }
    public synchronized String text(String path) { return contents.get(path); }
    public synchronized Set<String> paths() { return new LinkedHashSet<>(contents.keySet()); }
    public synchronized long count() { return sequence; }
    public Path journal() { return journal; }
    public IOException failure() { return failure; }
    public void markFailed(Throwable error) {
        if (failure == null) failure = error instanceof IOException ? (IOException) error : new IOException(error);
    }

    private void emit(String type, String path, Map<String, Object> details) {
        if (closed || failure != null) return;
        Map<String, Object> event = map("seq", ++sequence, "type", type);
        if (path != null) { event.put("fileId", ids.get(path)); event.put("path", path); }
        event.putAll(details);
        String line = Json.encode(event);
        writer.execute(() -> {
            if (failure != null) return;
            try { stream.write(line); stream.newLine(); stream.flush(); }
            catch (IOException e) { failure = e; onFailure.accept(e); }
        });
    }
    public synchronized void sync(String path, String text, String source) {
        if (closed || failure != null) return;
        String before = contents.get(path);
        if (Objects.equals(before, text)) return;
        if (before == null) {
            ids.put(path, "f" + (++nextId)); contents.put(path, text);
            emit("create", path, map("text", text, "source", source));
        } else {
            // A minimal replacement also handles external changes and discard-on-close.
            int start = 0, endA = before.length(), endB = text.length();
            while (start < endA && start < endB && before.charAt(start) == text.charAt(start)) start++;
            while (endA > start && endB > start && before.charAt(endA - 1) == text.charAt(endB - 1)) { endA--; endB--; }
            edit(path, start, before.substring(start, endA), text.substring(start, endB), source);
        }
    }
    public synchronized void edit(String path, int offset, String removed, String inserted, String source) {
        if (closed || failure != null) return;
        String before = contents.get(path);
        if (before == null || offset < 0 || offset + removed.length() > before.length()
                || !before.regionMatches(offset, removed, 0, removed.length()))
            throw new IllegalStateException("문서 변경 순서 불일치: " + path);
        contents.put(path, before.substring(0, offset) + inserted + before.substring(offset + removed.length()));
        emit("edit", path, map("offset", offset, "removedText", removed, "insertedText", inserted, "source", source));
    }
    public synchronized void activate(String path) {
        if (contents.containsKey(path) && !Objects.equals(active, path)) {
            active = path; emit("activate", path, Collections.emptyMap());
        }
    }
    public synchronized void delete(String path) {
        if (!contents.containsKey(path)) return;
        emit("delete", path, Collections.emptyMap()); contents.remove(path); ids.remove(path);
        if (Objects.equals(active, path)) active = null;
    }
    public synchronized void move(String from, String to) {
        if (from.equals(to) || !contents.containsKey(from)) return;
        if (contents.containsKey(to)) delete(to);
        emit("move", from, map("newPath", to));
        contents.put(to, contents.remove(from)); ids.put(to, ids.remove(from));
        if (Objects.equals(active, from)) active = to;
    }
    /** Called after listeners are detached. Heavy export runs off the UI thread. */
    public synchronized CompletableFuture<Path> finish() {
        if (closed) throw new IllegalStateException("이미 종료한 녹화입니다.");
        emit("end", null, Collections.emptyMap()); closed = true;
        CompletableFuture<Path> result = new CompletableFuture<>();
        writer.execute(() -> {
            Path temp = destination.resolveSibling(destination.getFileName() + ".partial");
            try {
                stream.close();
                if (failure != null) throw failure;
                try (BufferedReader in = Files.newBufferedReader(journal, StandardCharsets.UTF_8);
                     BufferedWriter out = Files.newBufferedWriter(temp, StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW)) {
                    String header = in.readLine();
                    out.write(header.substring(0, header.length() - 1)); out.write(",\"events\":[");
                    boolean first = true;
                    for (String line; (line = in.readLine()) != null;) {
                        if (!first) out.write(','); out.write(line); first = false;
                    }
                    out.write("]}");
                }
                Files.move(temp, destination);
                // Keep journal for recovery; user may remove it after checking the export.
                result.complete(destination);
            } catch (Throwable e) { result.completeExceptionally(e); }
        });
        writer.shutdown();
        return result;
    }
}
