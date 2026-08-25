// ─── 压缩/解压 ─────────────────────────────────────────────────

#[derive(Clone, Copy)]
enum ZlibFormat {
    Zlib,
    Raw,
    Gzip,
}

fn parse_zlib_format(format: Option<String>) -> ZlibFormat {
    match format.as_deref() {
        Some("gzip") => ZlibFormat::Gzip,
        Some("deflate-raw") => ZlibFormat::Raw,
        _ => ZlibFormat::Zlib,
    }
}

#[tauri::command]
pub fn zlib_inflate(data: Vec<u8>, format: Option<String>) -> Result<Vec<u8>, String> {
    match parse_zlib_format(format) {
        ZlibFormat::Gzip => {
            let mut output = Vec::new();
            let mut decoder = flate2::read::GzDecoder::new(data.as_slice());
            decoder
                .read_to_end(&mut output)
                .map_err(|err| format!("gzip 解压失败: {}", err))?;
            Ok(output)
        }
        ZlibFormat::Raw => {
            let mut output = Vec::new();
            let mut decoder = flate2::read::DeflateDecoder::new(data.as_slice());
            decoder
                .read_to_end(&mut output)
                .map_err(|err| format!("raw deflate 解压失败: {}", err))?;
            Ok(output)
        }
        ZlibFormat::Zlib => {
            let mut output = Vec::new();
            let mut decoder = flate2::read::ZlibDecoder::new(data.as_slice());
            match decoder.read_to_end(&mut output) {
                Ok(_) => Ok(output),
                Err(zlib_err) => {
                    let mut raw_output = Vec::new();
                    let mut raw_decoder = flate2::read::DeflateDecoder::new(data.as_slice());
                    raw_decoder
                        .read_to_end(&mut raw_output)
                        .map_err(|raw_err| {
                            format!("deflate 解压失败: zlib={}, raw={}", zlib_err, raw_err)
                        })?;
                    Ok(raw_output)
                }
            }
        }
    }
}

#[tauri::command]
pub fn zlib_deflate(data: Vec<u8>, format: Option<String>) -> Result<Vec<u8>, String> {
    match parse_zlib_format(format) {
        ZlibFormat::Gzip => {
            let mut encoder =
                flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
            encoder
                .write_all(&data)
                .map_err(|err| format!("gzip 写入压缩数据失败: {}", err))?;
            encoder
                .finish()
                .map_err(|err| format!("gzip 压缩失败: {}", err))
        }
        ZlibFormat::Raw => {
            let mut encoder =
                flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
            encoder
                .write_all(&data)
                .map_err(|err| format!("raw deflate 写入压缩数据失败: {}", err))?;
            encoder
                .finish()
                .map_err(|err| format!("raw deflate 压缩失败: {}", err))
        }
        ZlibFormat::Zlib => {
            let mut encoder =
                flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
            encoder
                .write_all(&data)
                .map_err(|err| format!("deflate 写入压缩数据失败: {}", err))?;
            encoder
                .finish()
                .map_err(|err| format!("deflate 压缩失败: {}", err))
        }
    }
}
