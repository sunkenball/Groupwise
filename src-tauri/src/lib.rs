mod net;
mod payouts;
mod roblox;
mod secrets;

use roblox::Roblox;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Roblox::new())
        .setup(|app| {
            // Cached Roblox responses survive restarts, so launching the app doesn't refetch everything.
            if let Ok(dir) = app.path().app_cache_dir() {
                app.state::<Roblox>().net.use_cache_file(dir.join("roblox-cache.json"));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            secrets::secrets_status,
            secrets::save_secret,
            secrets::clear_secret,
            roblox::cookie_user,
            roblox::login_with_roblox,
            roblox::list_groups,
            roblox::list_games,
            roblox::group_finance,
            roblox::user_finance,
            roblox::game_sales,
            roblox::exchange_rates,
            roblox::clear_cache,
            roblox::profile,
            roblox::analytics_query,
            payouts::group_payout,
            payouts::group_payout_verify,
            payouts::cancel_payout,
            payouts::find_payees,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
