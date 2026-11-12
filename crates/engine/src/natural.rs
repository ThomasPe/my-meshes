//! Ordering of names the way a file manager shows them (#74): upper and lower case together,
//! accented letters next to their base letter, runs of digits by their value ("Part 2"
//! before "Part 10"), and names that start with punctuation before digits before letters.
//! Plain byte order puts every capital before `_` and every lower-case letter, which reads
//! as unsorted in a folder tree.

use std::cmp::Ordering;

#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Token {
    /// Spaces, punctuation and symbols.
    Other(char),
    /// A run of digits without leading zeros: length first, then the digits, is its value.
    Number(usize, String),
    Letter(char),
}

/// The base letters of an accented Latin letter (already lower-cased); `None` for the rest.
fn unaccent(c: char) -> Option<&'static str> {
    Some(match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => "a",
        'æ' => "ae",
        'ç' | 'ć' | 'č' => "c",
        'ď' | 'đ' => "d",
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ė' | 'ę' | 'ě' => "e",
        'ğ' => "g",
        'ì' | 'í' | 'î' | 'ï' | 'ī' | 'į' | 'ı' => "i",
        'ł' | 'ľ' | 'ĺ' => "l",
        'ñ' | 'ń' | 'ň' => "n",
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ő' => "o",
        'œ' => "oe",
        'ř' | 'ŕ' => "r",
        'ś' | 'š' | 'ş' => "s",
        'ß' => "ss",
        'ť' | 'ţ' => "t",
        'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' | 'ų' => "u",
        'ý' | 'ÿ' => "y",
        'ź' | 'ż' | 'ž' => "z",
        _ => return None,
    })
}

fn tokens(s: &str) -> Vec<Token> {
    let mut out = Vec::new();
    let mut digits = String::new();
    let flush = |digits: &mut String, out: &mut Vec<Token>| {
        if !digits.is_empty() {
            let value = digits.trim_start_matches('0').to_string();
            out.push(Token::Number(value.len(), value));
            digits.clear();
        }
    };
    for c in s.chars() {
        if c.is_ascii_digit() {
            digits.push(c);
            continue;
        }
        flush(&mut digits, &mut out);
        for lower in c.to_lowercase() {
            match unaccent(lower) {
                Some(base) => out.extend(base.chars().map(Token::Letter)),
                None if lower.is_alphanumeric() => out.push(Token::Letter(lower)),
                None => out.push(Token::Other(lower)),
            }
        }
    }
    flush(&mut digits, &mut out);
    out
}

/// Compares two names for display. Names that only differ in case, accents or leading zeros
/// fall back to byte order, so the result is a total order and stable between runs.
pub fn cmp(a: &str, b: &str) -> Ordering {
    tokens(a).cmp(&tokens(b)).then_with(|| a.cmp(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sorted(mut names: Vec<&str>) -> Vec<&str> {
        names.sort_by(|a, b| cmp(a, b));
        names
    }

    #[test]
    fn folders_sort_like_a_file_manager() {
        // the tree of the report: byte order had `_Thomas` and `dclem08` after everything else
        assert_eq!(
            sorted(vec![
                "3D Printing World",
                "3DeepDesigns",
                "Cinderwing3D",
                "Diverse",
                "Gazzaladra",
                "Lofted Goods",
                "MattasaurusJax",
                "MrFozzie",
                "Saber3D",
                "_Thomas",
                "dclem08",
            ]),
            vec![
                "_Thomas",
                "3D Printing World",
                "3DeepDesigns",
                "Cinderwing3D",
                "dclem08",
                "Diverse",
                "Gazzaladra",
                "Lofted Goods",
                "MattasaurusJax",
                "MrFozzie",
                "Saber3D",
            ]
        );
    }

    #[test]
    fn numbers_by_value_accents_with_their_letter() {
        assert_eq!(
            sorted(vec!["Part 10", "Part 2", "part 1", "Part 02b", "Part"]),
            vec!["Part", "part 1", "Part 2", "Part 02b", "Part 10"]
        );
        assert_eq!(
            sorted(vec!["Zylinder", "Ärmel", "apfel", "Öse", "Ofen", "Straße", "Strasse 2"]),
            vec!["apfel", "Ärmel", "Ofen", "Öse", "Straße", "Strasse 2", "Zylinder"]
        );
        // a total order: equal apart from case or zeros still has one answer
        assert_eq!(cmp("abc", "ABC"), Ordering::Greater);
        assert_eq!(cmp("a01", "a1"), Ordering::Less);
        assert_eq!(cmp("same", "same"), Ordering::Equal);
        assert_eq!(sorted(vec!["b", "", "a"]), vec!["", "a", "b"]);
    }
}
