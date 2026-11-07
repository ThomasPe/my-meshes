//! Crash evidence for the field (spec 04-quality: no crash upload, so the evidence has to be
//! on the user's disk). A panic anywhere in the process is written to the app log with its
//! thread, location and a backtrace before the default hook runs; with `panic = "abort"` in
//! release builds that line is all that is left of a crash, and the diagnostics package
//! (APP-8) carries it to a bug report.

use std::any::Any;

pub fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info.location().map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()));
        log::error!("{}", panic_line(location.as_deref(), info.payload()));
        log::logger().flush();
        default(info);
    }));
}

/// The log line: thread, location, message and the first lines of a backtrace (release
/// builds are stripped, so the frames there are addresses; the location is what counts).
pub fn panic_line(location: Option<&str>, payload: &(dyn Any + Send)) -> String {
    let message = payload
        .downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "non-string panic payload".into());
    let thread = std::thread::current().name().unwrap_or("unnamed").to_string();
    let backtrace = std::backtrace::Backtrace::force_capture().to_string();
    let backtrace: Vec<&str> = backtrace.lines().take(40).collect();
    format!(
        "panic in thread '{thread}' at {}: {message}\n{}",
        location.unwrap_or("unknown location"),
        backtrace.join("\n")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panic_line_names_thread_location_and_message() {
        let line = panic_line(Some("src/commands.rs:12:5"), &"index out of range");
        assert!(line.starts_with("panic in thread '"), "{line}");
        assert!(line.contains("at src/commands.rs:12:5: index out of range"), "{line}");
        let owned = panic_line(None, &String::from("called `Option::unwrap()` on a `None` value"));
        assert!(owned.contains("at unknown location: called `Option::unwrap()`"), "{owned}");
        let other = panic_line(None, &42u8);
        assert!(other.contains("non-string panic payload"), "{other}");
    }
}
